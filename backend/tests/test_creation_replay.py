"""Real SQLite/HTTP recovery contracts using fictional isolated records only."""

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from dataclasses import replace
from threading import Barrier

import pytest
from app import creation_replay, db, main
from conftest import csrf_headers, setup_owner
from test_critical_path import create_foundation

KEY = "fictional-core-creation-retry-0001"
KINDS = ("campaigns", "prospects", "templates", "drafts", "replies", "prospects/import")


def snapshot(client):
    result = client.get("/api/export")
    assert result.status_code == 200
    content = result.json()
    # This response-generation timestamp is not a persisted record. Compare
    # every actual exported field/array exactly across calls at different times.
    del content["exported_at"]
    return content


def prepared(client, kind, *, initialize=True):
    if initialize:
        setup_owner(client)
    campaign, prospect, template = create_foundation(client)
    bodies = {
        "campaigns": {
            "name": "Private fictional campaign",
            "purpose": "Review a relevant exchange request",
            "lawful_basis": "Manually reviewed context",
        },
        "prospects": {
            "name": "Private fictional contact",
            "source_url": "https://example.org/fictional-retry-contact",
            "notes": "Private fictional context",
        },
        "templates": {
            "name": "Private fictional template",
            "body": "Hello {name}, a fictional reviewed exchange; no thanks is fine.",
        },
        "drafts": {"campaign_id": campaign, "prospect_id": prospect, "template_id": template},
        "prospects/import": {
            "csv_text": "name,source_url,notes\nFictional imported contact,https://example.org/import-retry,Private fictional CSV context\n",
            "commit": True,
        },
    }
    if kind == "replies":
        result = client.post("/api/drafts", headers=csrf_headers(client), json=bodies["drafts"])
        assert result.status_code == 201
        draft = result.json()["id"]
        # Isolated route fixture, not a provider send or manual-workflow proof.
        with db.transaction() as connection:
            connection.execute("UPDATE drafts SET state='ambiguous' WHERE id=?", (draft,))
        reminder = client.post(
            "/api/reminders",
            headers=csrf_headers(client),
            json={
                "draft_id": draft,
                "title": "Fictional open reply follow-up",
                "due_at": "2027-01-03T12:34:00Z",
            },
        )
        assert reminder.status_code == 201
        bodies[kind] = {
            "draft_id": draft,
            "body": "Private fictional reply",
            "received_at": "2027-01-02T12:34:00Z",
        }
    return bodies[kind]


def create(client, kind, body, key=KEY):
    return client.post(
        f"/api/{kind}", headers=csrf_headers(client, **{"Idempotency-Key": key}), json=body
    )


@pytest.mark.parametrize("kind", KINDS)
def test_same_attempt_recovers_original_without_any_additional_record_or_audit(client, kind):
    body = prepared(client, kind)
    original = create(client, kind, body)
    assert original.status_code == (200 if kind == "prospects/import" else 201), original.text
    before = snapshot(client)
    retry = create(client, kind, body)
    assert retry.status_code == original.status_code, retry.text
    # Compare actual persisted confirmation, not just a HTTP success status.
    if kind == "prospects/import":
        assert retry.json()["inserted"] == original.json()["inserted"] == 1
        assert retry.json()["duplicates"] == original.json()["duplicates"] == 0
    else:
        assert retry.json()["id"] == original.json()["id"]
    assert retry.json()["creation_key"] == KEY and retry.json()["replayed"] is True
    assert snapshot(client) == before


@pytest.mark.parametrize("kind", KINDS)
def test_original_confirmation_has_matching_key_and_no_private_receipt_copy(client, kind):
    body = prepared(client, kind)
    result = create(client, kind, body)
    assert result.status_code in {200, 201}
    assert result.json()["creation_key"] == KEY and result.json()["replayed"] is False
    receipt = db.fetch_one("SELECT * FROM core_creation_receipts")
    assert set(receipt) == {
        "workspace_id",
        "actor_user_id",
        "key_hash",
        "operation",
        "request_hash",
        "result_hash",
        "campaign_id",
        "prospect_id",
        "template_id",
        "draft_id",
        "reply_id",
        "audit_id",
        "created_at",
    }
    encoded = json.dumps(receipt)
    assert KEY not in encoded
    for field in ("name", "notes", "body", "csv_text", "source_url"):
        if field in body:
            assert body[field] not in encoded
    assert "core_creation_receipts" not in snapshot(client)
    assert "key_hash" not in json.dumps(client.get("/api/support-bundle").json())


@pytest.mark.parametrize("kind", KINDS)
def test_changed_saved_record_refuses_stale_confirmation(client, kind):
    body = prepared(client, kind)
    assert create(client, kind, body).status_code in {200, 201}
    receipt = db.fetch_one("SELECT * FROM core_creation_receipts")
    table, column = creation_replay.TARGETS[kind]
    field = {
        "campaigns": "purpose",
        "prospects": "notes",
        "templates": "body",
        "drafts": "state",
        "replies": "body",
        "prospects/import": "details",
    }[kind]
    value = (
        "approved"
        if kind == "drafts"
        else "{}"
        if kind == "prospects/import"
        else "Changed saved fictional content"
    )
    with db.transaction() as connection:
        connection.execute(f"UPDATE {table} SET {field}=? WHERE id=?", (value, receipt[column]))
    before = snapshot(client)
    refusal = create(client, kind, body)
    assert refusal.status_code == 409
    assert refusal.json()["error"]["code"] == "creation_receipt_unavailable"
    assert snapshot(client) == before


@pytest.mark.parametrize("kind", KINDS)
def test_deleted_record_tombstone_survives_actual_sqlite_id_reuse(client, kind):
    body = prepared(client, kind)
    first = create(client, kind, body)
    assert first.status_code in {200, 201}
    table, column = creation_replay.TARGETS[kind]
    receipt = db.fetch_one("SELECT * FROM core_creation_receipts")
    with db.transaction() as connection:
        connection.execute(f"DELETE FROM {table} WHERE id=?", (receipt[column],))
        if kind == "replies":
            connection.execute(
                "UPDATE drafts SET state='ambiguous' WHERE id=?", (body["draft_id"],)
            )
    assert db.fetch_one(f"SELECT {column} FROM core_creation_receipts")[column] is None
    second = create(client, kind, body, "fictional-replacement-creation-0002")
    assert second.status_code in {200, 201}, second.text
    replacement = db.fetch_one(
        "SELECT * FROM core_creation_receipts WHERE key_hash<>?", (receipt["key_hash"],)
    )
    assert replacement[column] == receipt[column]
    before = snapshot(client)
    refusal = create(client, kind, body)
    assert refusal.status_code == 409
    assert refusal.json()["error"]["code"] == "creation_receipt_unavailable"
    assert snapshot(client) == before


@pytest.mark.parametrize("kind", KINDS)
def test_concurrent_requests_commit_once(client, kind):
    body = prepared(client, kind)
    barrier = Barrier(2)

    def submit():
        barrier.wait(timeout=10)
        return create(client, kind, body)

    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _: submit(), range(2)))
    assert all(result.status_code in {200, 201} for result in results)
    assert results[0].json() == {**results[1].json(), "replayed": results[0].json()["replayed"]}
    assert sorted(result.json()["replayed"] for result in results) == [False, True]
    assert db.fetch_one("SELECT COUNT(*) AS n FROM core_creation_receipts")["n"] == 1


@pytest.mark.parametrize("kind", KINDS)
def test_receipt_failure_rolls_back_all_records_and_side_effects(client, kind, monkeypatch):
    body = prepared(client, kind)
    before = snapshot(client)
    original = creation_replay.remember

    def fail(*args):
        original(*args)
        raise sqlite3.OperationalError("Fictional receipt failure")

    with monkeypatch.context() as scoped:
        scoped.setattr(creation_replay, "remember", fail)
        with pytest.raises(sqlite3.OperationalError):
            create(client, kind, body)
    assert snapshot(client) == before
    assert db.fetch_one("SELECT COUNT(*) AS n FROM core_creation_receipts")["n"] == 0
    assert create(client, kind, body).json()["replayed"] is False


@pytest.mark.parametrize("kind", KINDS)
def test_capacity_never_prunes_existing_refs(client, kind, monkeypatch):
    body = prepared(client, kind)
    assert create(client, kind, body).status_code in {200, 201}
    monkeypatch.setattr(creation_replay, "RECEIPT_LIMIT", 1)
    with db.transaction() as connection:
        connection.execute("UPDATE core_creation_receipts SET created_at='1900-01-01T00:00:00Z'")
    assert create(client, kind, body).json()["replayed"] is True
    before = snapshot(client)
    refusal = create(client, kind, body, "fictional-unused-reference-0002")
    assert refusal.status_code == 409
    assert refusal.json()["error"]["code"] == "creation_receipt_limit"
    assert snapshot(client) == before
    assert db.fetch_one("SELECT COUNT(*) AS n FROM core_creation_receipts")["n"] == 1


@pytest.mark.parametrize("kind", KINDS)
def test_recovery_requires_csrf_live_session_and_current_writer_role(client, kind):
    body = prepared(client, kind)
    assert create(client, kind, body).status_code in {200, 201}
    assert (
        client.post(f"/api/{kind}", json=body, headers={"Idempotency-Key": KEY}).status_code == 403
    )
    with db.transaction() as connection:
        connection.execute("UPDATE memberships SET role='viewer'")
    assert create(client, kind, body).status_code == 403
    with db.transaction() as connection:
        connection.execute("UPDATE memberships SET role='owner'")
        connection.execute("DELETE FROM sessions")
    assert create(client, kind, body).status_code == 401
    assert db.fetch_one("SELECT COUNT(*) AS n FROM core_creation_receipts")["n"] == 1


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("revocation", ("session", "membership", "role"))
def test_authority_change_between_dependency_and_writer_reservation_is_refused(
    client, kind, revocation, monkeypatch
):
    body = prepared(client, kind)
    assert create(client, kind, body).status_code in {200, 201}
    original = main.require_role
    changed = False

    def revoke(member, *roles):
        nonlocal changed
        original(member, *roles)
        if not changed:
            changed = True
            with db.transaction() as connection:
                connection.execute(
                    {
                        "session": "DELETE FROM sessions",
                        "membership": "DELETE FROM memberships",
                        "role": "UPDATE memberships SET role='viewer'",
                    }[revocation]
                )

    monkeypatch.setattr(main, "require_role", revoke)
    assert create(client, kind, body).status_code == (403 if revocation == "role" else 401)


@pytest.mark.parametrize("kind", KINDS)
def test_invalid_and_duplicate_headers_are_prewrite_refusals(client, kind):
    body = prepared(client, kind)
    before = snapshot(client)
    for key in ("", "short", "x" * 121, "space in this reference", "x" * 16 + ",", " x" * 16):
        result = create(client, kind, body, key)
        assert (
            result.status_code == 400 and result.json()["error"]["code"] == "creation_key_invalid"
        )
    headers = list(csrf_headers(client).items()) + [("Idempotency-Key", KEY)] * 2
    assert client.post(f"/api/{kind}", headers=headers, json=body).status_code == 400
    assert snapshot(client) == before


def test_key_cannot_be_repurposed_for_another_endpoint(client):
    body = prepared(client, "campaigns")
    assert create(client, "campaigns", body).status_code == 201
    other = {
        "name": "Different fictional template",
        "body": "Hello {name}, a relevant fictional exchange; no thanks is fine.",
    }
    before = snapshot(client)
    refusal = create(client, "templates", other)
    assert refusal.status_code == 409 and refusal.json()["error"]["code"] == "creation_key_conflict"
    assert snapshot(client) == before


@pytest.mark.parametrize("kind", ("campaigns", "prospects", "templates", "replies"))
def test_normalized_values_recover_same_result(client, kind):
    body = prepared(client, kind)
    original = create(client, kind, body)
    changed = {
        key: "  " + value + "  " if isinstance(value, str) else value for key, value in body.items()
    }
    if kind in {"prospects", "templates"}:
        changed["provider"] = " SIMBI "
    if kind == "prospects":
        changed["source_url"] = body["source_url"] + "#irrelevant-fragment"
    if kind == "replies":
        changed["received_at"] = "2027-01-02T14:34:00+02:00"
    result = create(client, kind, changed)
    assert result.status_code == 201 and result.json() == {**original.json(), "replayed": True}


def test_csv_preview_never_consumes_key_and_equivalent_import_recovers_original_counts(client):
    body = prepared(client, "prospects/import")
    preview = create(client, "prospects/import", {**body, "commit": False}, "short")
    assert preview.status_code == 200 and preview.json()["committed"] is False
    assert "creation_key" not in preview.json()
    assert db.fetch_one("SELECT COUNT(*) AS n FROM core_creation_receipts")["n"] == 0
    original = create(client, "prospects/import", body)
    equivalent = (
        body["csv_text"]
        .replace("notes\n", "notes,ignored\r\n")
        .replace("context\n", "context,unused\r\n")
    )
    retry = create(client, "prospects/import", {**body, "csv_text": equivalent})
    assert retry.status_code == 200 and retry.json() == {**original.json(), "replayed": True}


def test_csv_replay_is_historical_and_does_not_reinsert_removed_imported_contacts(client):
    body = prepared(client, "prospects/import")
    original = create(client, "prospects/import", body)
    with db.transaction() as connection:
        connection.execute(
            "DELETE FROM prospects WHERE source_url='https://example.org/import-retry'"
        )
    before = snapshot(client)
    retry = create(client, "prospects/import", body)
    assert retry.json() == {**original.json(), "replayed": True}
    assert snapshot(client) == before


def test_default_reply_time_recovers_original_instead_of_new_clock_value(client):
    body = prepared(client, "replies")
    del body["received_at"]
    original = create(client, "replies", body)
    retry = create(client, "replies", {**body, "received_at": None})
    assert retry.status_code == 201 and retry.json() == {**original.json(), "replayed": True}


@pytest.mark.parametrize("kind", KINDS)
def test_legacy_unkeyed_shape_remains_compatible_without_receipt(client, kind):
    body = prepared(client, kind)
    result = client.post(f"/api/{kind}", headers=csrf_headers(client), json=body)
    assert result.status_code in {200, 201} and "creation_key" not in result.json()
    assert db.fetch_one("SELECT COUNT(*) AS n FROM core_creation_receipts")["n"] == 0


def test_legacy_five_migration_restore_preserves_rows_and_adds_empty_receipts(
    client, tmp_path, monkeypatch
):
    body = prepared(client, "prospects")
    result = client.post("/api/prospects", headers=csrf_headers(client), json=body)
    assert result.status_code == 201
    legacy = tmp_path / "legacy-five.db"
    with closing(db.connect()) as current, closing(sqlite3.connect(legacy)) as old:
        current.backup(old)
        with old:
            old.execute("DROP TABLE core_creation_receipts")
            old.execute("DELETE FROM schema_migrations WHERE name='006_core_creation_receipts.sql'")
        db._validate_schema(old)
    monkeypatch.setattr(
        db,
        "settings",
        replace(
            db.settings,
            database_path=tmp_path / "restored.db",
            backup_path=tmp_path / "safety",
        ),
    )
    db.restore_backup(legacy)
    with closing(db.connect()) as connection:
        db._validate_schema(connection)
        assert (
            connection.execute(
                "SELECT notes FROM prospects WHERE id=?", (result.json()["id"],)
            ).fetchone()[0]
            == body["notes"]
        )
        assert connection.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0] == 6
        assert connection.execute("SELECT COUNT(*) FROM core_creation_receipts").fetchone()[0] == 0


@pytest.mark.parametrize("kind", KINDS)
def test_complete_backup_restore_preserves_retry_confirmation(client, kind, tmp_path, monkeypatch):
    body = prepared(client, kind)
    original = create(client, kind, body)
    with closing(db.connect()) as connection:
        backup = db._snapshot(connection, tmp_path / "complete-backups")
    monkeypatch.setattr(
        db,
        "settings",
        replace(
            db.settings,
            database_path=tmp_path / "restored.db",
            backup_path=tmp_path / "restore-safety",
        ),
    )
    db.restore_backup(backup)
    before = snapshot(client)
    result = create(client, kind, body)
    assert result.status_code == original.status_code and result.json() == {
        **original.json(),
        "replayed": True,
    }
    assert snapshot(client) == before
    with closing(db.connect()) as connection:
        assert connection.execute("PRAGMA foreign_key_check").fetchone() is None


def test_personal_cleanup_preserves_tombstones_and_retirement_removes_core_receipts(client):
    from test_privacy_cleanup import confirm, preview
    from test_retirement import confirm as retire_confirm
    from test_retirement import pause
    from test_retirement import preview as retire_preview

    body = prepared(client, "prospects")
    original = create(client, "prospects", body)
    plan = preview(client, original.json()["id"])
    assert plan.status_code == 200
    assert confirm(client, plan.json()["plan_id"]).status_code == 200
    assert db.fetch_one("SELECT prospect_id FROM core_creation_receipts")["prospect_id"] is None
    assert (
        create(client, "prospects", body).json()["error"]["code"] == "creation_receipt_unavailable"
    )
    pause(client)
    retirement = retire_preview(client)
    assert (
        retirement.status_code == 200 and retirement.json()["counts"]["core_creation_receipts"] == 1
    )
    assert retire_confirm(client, retirement.json()["plan_id"]).status_code == 200
    assert db.fetch_one("SELECT COUNT(*) AS n FROM core_creation_receipts")["n"] == 0


def test_csv_opt_out_side_effects_are_atomic_and_recovery_does_not_repeat_them(client, monkeypatch):
    body = prepared(client, "prospects/import")
    source = "https://simbi.com/person-1"
    existing = db.fetch_one("SELECT * FROM prospects ORDER BY id LIMIT 1")
    source = existing["source_url"]
    body["csv_text"] = f"name,source_url,consent_status\nFictional opt-out,{source},opted_out\n"
    before = snapshot(client)
    original = creation_replay.remember

    def fail(*args):
        original(*args)
        raise sqlite3.OperationalError("Fictional receipt failure")

    with monkeypatch.context() as scoped:
        scoped.setattr(creation_replay, "remember", fail)
        with pytest.raises(sqlite3.OperationalError):
            create(client, "prospects/import", body)
    assert snapshot(client) == before
    result = create(client, "prospects/import", body)
    assert result.status_code == 200 and result.json()["duplicates"] == 1
    after = snapshot(client)
    assert after["suppressions"] and after["prospects"][0]["consent_status"] == "opted_out"
    assert create(client, "prospects/import", body).json() == {**result.json(), "replayed": True}
    assert snapshot(client) == after


@pytest.mark.parametrize("kind", KINDS)
def test_other_actor_cannot_recover_owners_reference(client, kind):
    body = prepared(client, kind)
    assert create(client, kind, body).status_code in {200, 201}
    with db.transaction() as connection:
        connection.execute(
            "INSERT INTO users(id,email,password_hash,display_name,created_at) SELECT 2,"
            "'other@example.test',password_hash,'Other fictional owner',created_at FROM users WHERE id=1"
        )
        connection.execute("INSERT INTO memberships VALUES (2,1,'owner')")
    assert client.post("/api/auth/logout", headers=csrf_headers(client), json={}).status_code == 200
    assert (
        client.post(
            "/api/auth/login",
            json={
                "email": "other@example.test",
                "password": "correct horse battery staple",
            },
        ).status_code
        == 200
    )
    result = create(client, kind, body)
    if kind == "prospects/import":
        assert result.status_code == 200 and result.json()["replayed"] is False
        assert result.json()["inserted"] == 0 and result.json()["duplicates"] == 1
    else:
        assert result.status_code == 409
        assert result.json()["error"]["code"] == (
            "reply_not_expected" if kind == "replies" else "conflict"
        )
        assert "creation_key" not in result.json()


@pytest.mark.parametrize("kind", KINDS)
def test_workspace_and_actor_scopes_do_not_share_recovery_results(client, kind):
    body = prepared(client, kind)
    first = create(client, kind, body)
    assert first.status_code in {200, 201}
    with db.transaction() as connection:
        connection.execute(
            "INSERT INTO users(id,email,password_hash,display_name,created_at) SELECT 2,"
            "'other@example.test',password_hash,'Other fictional owner',created_at FROM users WHERE id=1"
        )
        connection.execute(
            "INSERT INTO workspaces(id,name,created_at) VALUES (2,'Other fictional workspace',?)",
            (db.now(),),
        )
        connection.execute("INSERT INTO memberships VALUES (2,2,'owner')")
    assert client.post("/api/auth/logout", headers=csrf_headers(client), json={}).status_code == 200
    assert (
        client.post(
            "/api/auth/login",
            json={
                "email": "other@example.test",
                "password": "correct horse battery staple",
            },
        ).status_code
        == 200
    )
    other_body = prepared(client, kind, initialize=False)
    result = create(client, kind, other_body)
    assert result.status_code == first.status_code and result.json()["replayed"] is False
    if kind != "prospects/import":
        assert result.json()["id"] != first.json()["id"]
    before = snapshot(client)
    replay = create(client, kind, other_body)
    assert replay.json() == {**result.json(), "replayed": True}
    assert snapshot(client) == before
    assert db.fetch_one("SELECT COUNT(*) AS n FROM core_creation_receipts")["n"] == 2


@pytest.mark.parametrize("kind", KINDS)
def test_schema_prevents_cross_workspace_receipt_links_on_insert_and_update(client, kind):
    body = prepared(client, kind)
    assert create(client, kind, body).status_code in {200, 201}
    receipt = db.fetch_one("SELECT * FROM core_creation_receipts")
    _, column = creation_replay.TARGETS[kind]
    with db.transaction() as connection:
        connection.execute(
            "INSERT INTO workspaces(id,name,created_at) VALUES (2,'Other fictional workspace',?)",
            (db.now(),),
        )
        with pytest.raises(sqlite3.IntegrityError, match="Creation receipt workspace mismatch"):
            connection.execute("UPDATE core_creation_receipts SET workspace_id=2")
        with pytest.raises(sqlite3.IntegrityError, match="Creation receipt workspace mismatch"):
            connection.execute(
                f"INSERT INTO core_creation_receipts(workspace_id,actor_user_id,key_hash,operation,"
                f"request_hash,result_hash,{column},created_at) VALUES (?,?,?,?,?,?,?,?)",
                (
                    2,
                    1,
                    "f" * 64,
                    kind,
                    receipt["request_hash"],
                    receipt["result_hash"],
                    receipt[column],
                    db.now(),
                ),
            )


@pytest.mark.parametrize("kind", KINDS)
def test_changed_request_cannot_turn_committed_reference_into_another_attempt(client, kind):
    body = prepared(client, kind)
    assert create(client, kind, body).status_code in {200, 201}
    changed = dict(body)
    if kind == "drafts":
        other = client.post(
            "/api/templates",
            headers=csrf_headers(client),
            json={
                "name": "Other fictional template",
                "body": "Hello {name}, another fictional reviewed exchange; no thanks is fine.",
            },
        )
        assert other.status_code == 201
        changed["template_id"] = other.json()["id"]
    elif kind == "prospects/import":
        changed["csv_text"] = body["csv_text"].replace(
            "Private fictional CSV context", "Changed fictional CSV context"
        )
    else:
        changed[
            {"campaigns": "purpose", "prospects": "notes", "templates": "body", "replies": "body"}[
                kind
            ]
        ] = "Different fictional values for this attempt"
    before = snapshot(client)
    result = create(client, kind, changed)
    assert result.status_code == 409
    assert result.json()["error"]["code"] == "creation_key_conflict"
    assert snapshot(client) == before
