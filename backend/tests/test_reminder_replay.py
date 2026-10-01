import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from dataclasses import replace
from threading import Barrier

import pytest
from app import db, main, reminder_replay
from conftest import csrf_headers, setup_owner
from test_critical_path import create_foundation

KEY = "fictional-reminder-retry-0001"


def prepared(client):
    setup_owner(client)
    _, prospect, _ = create_foundation(client)
    return {
        "prospect_id": prospect,
        "title": "Private fictional reminder",
        "due_at": "2027-01-02T12:34:00Z",
    }


def create(client, body, key=KEY):
    return client.post(
        "/api/reminders", headers=csrf_headers(client, **{"Idempotency-Key": key}), json=body
    )


def test_retry_returns_original_confirmation_without_duplicate_or_audit(client):
    body = prepared(client)
    original = create(client, body)
    assert original.status_code == 201
    before = client.get("/api/export").json()
    retry = create(client, body)
    assert retry.status_code == 201
    assert retry.json()["id"] == original.json()["id"]
    assert retry.json()["creation_key"] == KEY and retry.json()["replayed"] is True
    assert client.get("/api/export").json()["reminders"] == before["reminders"]
    assert client.get("/api/export").json()["audit_events"] == before["audit_events"]


def test_changed_payload_cannot_reuse_a_committed_key(client):
    body = prepared(client)
    assert create(client, body).status_code == 201
    retry = create(client, {**body, "title": "A different reminder"})
    assert retry.status_code == 409
    assert retry.json()["error"]["code"] == "reminder_key_conflict"
    assert client.get("/api/reminders").json()["total"] == 1


def test_deleted_record_does_not_reappear_even_if_sqlite_reuses_its_id(client):
    body = prepared(client)
    original_id = create(client, body).json()["id"]
    with db.transaction() as connection:
        connection.execute("DELETE FROM reminders WHERE id=?", (original_id,))
    replacement = create(client, body, "fictional-different-key-0002")
    assert replacement.json()["id"] == original_id
    retry = create(client, body)
    assert retry.status_code == 409
    assert retry.json()["error"]["code"] == "reminder_receipt_unavailable"
    assert client.get("/api/reminders").json()["total"] == 1


def test_completed_record_does_not_return_a_stale_open_confirmation(client):
    body = prepared(client)
    reminder_id = create(client, body).json()["id"]
    assert (
        client.patch(
            f"/api/reminders/{reminder_id}", headers=csrf_headers(client), json={"status": "done"}
        ).status_code
        == 200
    )
    retry = create(client, body)
    assert retry.status_code == 409
    assert retry.json()["error"]["code"] == "reminder_receipt_unavailable"
    assert client.get("/api/reminders?status=open").json()["total"] == 0


@pytest.mark.parametrize(
    "key", ["", "short", "x" * 121, "space in this reference", "x" * 16 + ",", " x" * 16]
)
def test_invalid_keys_are_prewrite_refusals(client, key):
    body = prepared(client)
    result = create(client, body, key)
    assert result.status_code == 400
    assert result.json()["error"]["code"] == "reminder_key_invalid"
    assert client.get("/api/reminders").json()["total"] == 0
    assert db.fetch_one("SELECT COUNT(*) AS n FROM reminder_creation_receipts")["n"] == 0


def test_duplicate_header_is_refused(client):
    body = prepared(client)
    headers = list(csrf_headers(client).items()) + [
        ("Idempotency-Key", KEY),
        ("Idempotency-Key", KEY),
    ]
    assert client.post("/api/reminders", headers=headers, json=body).status_code == 400
    assert client.get("/api/reminders").json()["total"] == 0


def test_equivalent_normalized_values_replay_and_receipt_has_no_content_copy(client):
    body = prepared(client)
    original = create(client, {**body, "title": "  " + body["title"] + "  "})
    retry = create(client, {**body, "due_at": "2027-01-02T14:34:00+02:00", "draft_id": None})
    assert retry.status_code == 201 and retry.json()["id"] == original.json()["id"]
    receipt = db.fetch_one("SELECT * FROM reminder_creation_receipts")
    assert set(receipt) == {
        "workspace_id",
        "actor_user_id",
        "key_hash",
        "request_hash",
        "result_hash",
        "reminder_id",
        "created_at",
    }
    assert KEY not in json.dumps(receipt) and body["title"] not in json.dumps(receipt)
    assert body["due_at"] not in json.dumps(receipt)
    assert "reminder_creation_receipts" not in client.get("/api/export").json()
    assert "key_hash" not in json.dumps(client.get("/api/support-bundle").json())


def test_same_key_concurrent_writers_commit_only_once(client):
    body = prepared(client)
    gate = Barrier(2)

    def submit():
        gate.wait(timeout=10)
        return create(client, body)

    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _: submit(), range(2)))
    assert all(result.status_code == 201 for result in results)
    assert results[0].json()["id"] == results[1].json()["id"]
    assert sorted(result.json()["replayed"] for result in results) == [False, True]
    assert db.fetch_one("SELECT COUNT(*) AS n FROM reminders")["n"] == 1
    assert (
        db.fetch_one("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='reminder.created'")[
            "n"
        ]
        == 1
    )


def test_failed_receipt_insert_rolls_back_record_and_audit(client, monkeypatch):
    body = prepared(client)
    before = client.get("/api/export").json()["audit_events"]
    original = reminder_replay.remember

    def fail(*args):
        original(*args)
        raise sqlite3.OperationalError("Fictional receipt failure")

    with monkeypatch.context() as scoped:
        scoped.setattr(reminder_replay, "remember", fail)
        with pytest.raises(sqlite3.OperationalError):
            create(client, body)
    assert client.get("/api/export").json()["audit_events"] == before
    assert client.get("/api/reminders").json()["total"] == 0
    assert db.fetch_one("SELECT COUNT(*) AS n FROM reminder_creation_receipts")["n"] == 0
    assert create(client, body).json()["replayed"] is False


def test_limit_preserves_existing_receipts_without_pruning(client, monkeypatch):
    body = prepared(client)
    assert create(client, body).status_code == 201
    monkeypatch.setattr(reminder_replay, "RECEIPT_LIMIT", 1)
    assert create(client, body).json()["replayed"] is True
    refusal = create(client, body, "fictional-new-reference-0002")
    assert (
        refusal.status_code == 409 and refusal.json()["error"]["code"] == "reminder_receipt_limit"
    )
    assert client.get("/api/reminders").json()["total"] == 1


def test_replay_requires_csrf_session_and_current_write_role(client):
    body = prepared(client)
    assert create(client, body).status_code == 201
    assert (
        client.post("/api/reminders", json=body, headers={"Idempotency-Key": KEY}).status_code
        == 403
    )
    with db.transaction() as connection:
        connection.execute("UPDATE memberships SET role='viewer'")
    assert create(client, body).status_code == 403
    with db.transaction() as connection:
        connection.execute("UPDATE memberships SET role='owner'")
        connection.execute("DELETE FROM sessions")
    assert create(client, body).status_code == 401
    assert db.fetch_one("SELECT COUNT(*) AS n FROM reminders")["n"] == 1


def test_authority_is_rechecked_after_dependency_before_transaction(client, monkeypatch):
    body = prepared(client)
    assert create(client, body).status_code == 201
    original = main.require_role
    changed = False

    def revoke(member, *roles):
        nonlocal changed
        original(member, *roles)
        if not changed:
            changed = True
            with db.transaction() as connection:
                connection.execute("UPDATE memberships SET role='viewer'")

    monkeypatch.setattr(main, "require_role", revoke)
    assert create(client, body).status_code == 403


def test_another_workspace_cannot_recover_an_owners_receipt(client):
    body = prepared(client)
    original = create(client, body).json()
    with db.transaction() as connection:
        connection.execute(
            "INSERT INTO users(id,email,password_hash,display_name,created_at) SELECT 2,'other@example.test',password_hash,'Other fictional owner',created_at FROM users WHERE id=1"
        )
        connection.execute(
            "INSERT INTO workspaces(id,name,created_at) VALUES (2,'Other fictional workspace',?)",
            (db.now(),),
        )
        connection.execute("INSERT INTO memberships VALUES (2,2,'owner')")
        connection.execute(
            "INSERT INTO prospects(id,workspace_id,name,source_url,created_at,updated_at) VALUES (2,2,'Other fictional person','https://simbi.com/other-fictional',?,?)",
            (db.now(), db.now()),
        )
    assert client.post("/api/auth/logout", headers=csrf_headers(client), json={}).status_code == 200
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "other@example.test", "password": "correct horse battery staple"},
        ).status_code
        == 200
    )
    assert create(client, body).status_code == 404
    separate = create(client, {**body, "prospect_id": 2})
    assert separate.status_code == 201 and separate.json()["id"] != original["id"]
    assert separate.json()["replayed"] is False
    assert db.fetch_one("SELECT COUNT(*) AS n FROM reminder_creation_receipts")["n"] == 2


def test_legacy_unkeyed_callers_keep_their_shape_but_are_not_deduplicated(client):
    body = prepared(client)
    original = client.post("/api/reminders", headers=csrf_headers(client), json=body)
    second = client.post("/api/reminders", headers=csrf_headers(client), json=body)
    assert original.status_code == second.status_code == 201
    assert original.json()["id"] != second.json()["id"]
    assert "creation_key" not in original.json()
    assert db.fetch_one("SELECT COUNT(*) AS n FROM reminder_creation_receipts")["n"] == 0


def test_privacy_cleanup_retains_tombstone_and_retirement_counts_and_removes_it(client):
    from test_privacy_cleanup import confirm, preview
    from test_retirement import confirm as retire_confirm
    from test_retirement import pause
    from test_retirement import preview as retire_preview

    body = prepared(client)
    assert create(client, body).status_code == 201
    plan = preview(client, body["prospect_id"])
    assert plan.status_code == 200
    removed = confirm(client, plan.json()["plan_id"])
    assert removed.status_code == 200, removed.text
    assert db.fetch_one("SELECT reminder_id FROM reminder_creation_receipts")["reminder_id"] is None
    assert create(client, body).json()["error"]["code"] == "reminder_receipt_unavailable"
    pause(client)
    retirement = retire_preview(client)
    assert retirement.status_code == 200, retirement.text
    assert retirement.json()["counts"]["reminder_creation_receipts"] == 1
    result = retire_confirm(client, retirement.json()["plan_id"])
    assert result.status_code == 200, result.text
    assert db.fetch_one("SELECT COUNT(*) AS n FROM reminder_creation_receipts")["n"] == 0


def test_legacy_four_migration_restore_adds_receipts_without_losing_rows(
    client, tmp_path, monkeypatch
):
    body = prepared(client)
    assert client.post("/api/reminders", json=body, headers=csrf_headers(client)).status_code == 201
    legacy = tmp_path / "legacy-four.db"
    with closing(db.connect()) as current, closing(sqlite3.connect(legacy)) as old:
        current.backup(old)
        with old:
            old.execute("DROP TABLE reminder_creation_receipts")
            old.execute(
                "DELETE FROM schema_migrations WHERE name='005_reminder_creation_receipts.sql'"
            )
        db._validate_schema(old)
    target = tmp_path / "restored.db"
    monkeypatch.setattr(
        db,
        "settings",
        replace(db.settings, database_path=target, backup_path=tmp_path / "restore-backups"),
    )
    db.restore_backup(legacy)
    with closing(db.connect()) as restored:
        db._validate_schema(restored)
        assert restored.execute("SELECT title FROM reminders").fetchone()[0] == body["title"]
        assert (
            restored.execute("SELECT COUNT(*) FROM reminder_creation_receipts").fetchone()[0] == 0
        )
        assert restored.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0] == 5


def test_complete_backup_restore_preserves_actual_replay_receipt(client, tmp_path, monkeypatch):
    body = prepared(client)
    original = create(client, body).json()
    with closing(db.connect()) as connection:
        backup = db._snapshot(connection, tmp_path / "complete-backups")
    monkeypatch.setattr(
        db,
        "settings",
        replace(
            db.settings,
            database_path=tmp_path / "restored-receipt.db",
            backup_path=tmp_path / "restore-safety",
        ),
    )
    db.restore_backup(backup)
    replay = create(client, body)
    assert replay.status_code == 201
    assert replay.json() == {**original, "replayed": True}
    assert db.fetch_one("SELECT COUNT(*) AS n FROM reminders")["n"] == 1
    assert (
        db.fetch_one("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='reminder.created'")[
            "n"
        ]
        == 1
    )
