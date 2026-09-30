from __future__ import annotations

import json
import sqlite3
from contextlib import closing

import pytest
from app import db, main, privacy
from app.security import hash_password
from conftest import csrf_headers, setup_owner
from test_critical_path import create_foundation

TEST_PASSPHRASE = "correct horse battery staple"  # noqa: S105 - isolated fixtures only
INVALID_PASSPHRASE = "incorrect"  # noqa: S105 - isolated invalid fixture


def contact(client, suffix="one"):
    response = client.post(
        "/api/prospects",
        headers=csrf_headers(client),
        json={
            "name": f"Private {suffix}",
            "source_url": f"https://simbi.com/fictional-{suffix}",
            "notes": "private contact notes",
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def preview(client, prospect_id=None):
    return client.post(
        "/api/privacy/preview",
        headers=csrf_headers(client),
        json={"kind": "prospect", "prospect_id": prospect_id}
        if prospect_id
        else {"kind": "retention"},
    )


def confirm(client, plan_id, **overrides):
    return client.post(
        "/api/privacy/confirm",
        headers=csrf_headers(client),
        json={
            "plan_id": plan_id,
            "current_password": TEST_PASSPHRASE,
            "confirmed": True,
            **overrides,
        },
    )


def aged_conversation(client):
    campaign, prospect, template = create_foundation(client)
    draft = client.post(
        "/api/drafts",
        headers=csrf_headers(client),
        json={"campaign_id": campaign, "prospect_id": prospect, "template_id": template},
    ).json()["id"]
    with db.transaction() as connection:
        for table in ("prospects", "campaigns", "drafts"):
            connection.execute(
                f"UPDATE {table} SET created_at=?,updated_at=?",
                ("2020-01-01T00:00:00+00:00", "2020-01-01T00:00:00+00:00"),
            )
        connection.execute("UPDATE campaigns SET status='archived'")
        connection.execute("UPDATE audit_events SET created_at='2020-01-01T00:00:00+00:00'")
        connection.execute(
            "INSERT INTO replies(workspace_id,draft_id,body,created_by,received_at,created_at) VALUES (1,?,'private reply',1,'2020-01-01T00:00:00+00:00','2020-01-01T00:00:00+00:00')",
            (draft,),
        )
    return campaign, prospect, template, draft


def test_preview_and_cancel_do_not_delete_and_confirmation_has_prechange_backup(client):
    setup_owner(client)
    _, prospect, _, _ = aged_conversation(client)
    response = preview(client)
    assert response.status_code == 200, response.text
    plan = response.json()
    assert plan["counts"] == {
        "prospects": 1,
        "drafts": 1,
        "handoffs": 0,
        "replies": 1,
        "reminders": 0,
    }
    assert client.get("/api/prospects").json()["total"] == 1
    assert not list(privacy.settings.backup_path.glob("*.db"))
    result = confirm(client, plan["plan_id"])
    assert result.status_code == 200, result.text
    receipt = result.json()
    backup = privacy.settings.backup_path / receipt["backup_file"]
    with closing(sqlite3.connect(backup)) as connection:
        assert connection.execute("SELECT COUNT(*) FROM prospects").fetchone()[0] == 1
        assert connection.execute("SELECT body FROM replies").fetchone()[0] == "private reply"
        assert (
            connection.execute("SELECT receipt_json FROM privacy_cleanup_plans").fetchone()[0]
            is None
        )
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    exported = client.get("/api/export").json()
    assert not exported["prospects"] and not exported["drafts"] and not exported["replies"]
    assert len(exported["campaigns"]) == len(exported["templates"]) == 1
    assert exported["suppressions"][0]["prospect_id"] is None
    event = db.fetch_one(
        "SELECT details FROM audit_events WHERE event_type='privacy.cleanup_completed'"
    )
    assert "private reply" not in event["details"] and "Private" not in event["details"]
    replay = confirm(client, plan["plan_id"])
    assert replay.status_code == 200 and replay.json()["replayed"] is True
    assert len(list(privacy.settings.backup_path.glob("*.db"))) == 1
    assert (
        db.fetch_one(
            "SELECT COUNT(*) AS n FROM audit_events WHERE event_type='privacy.cleanup_completed'"
        )["n"]
        == 1
    )
    assert not db.fetch_one("SELECT id FROM prospects WHERE id=?", (prospect,))
    assert (
        client.post(
            "/api/prospects",
            headers=csrf_headers(client),
            json={
                "name": "Recreated",
                "source_url": "https://simbi.com/alex-morgan-request",
                "consent_status": "consented",
            },
        ).json()["consent_status"]
        == "opted_out"
    )


@pytest.mark.parametrize(
    "mutation",
    [
        "notes",
        "new_reply",
        "reminder_done",
        "campaign",
        "suppression",
        "retention",
        "expiry",
        "new_preview",
    ],
)
def test_stale_and_expired_previews_fail_closed(client, mutation):
    setup_owner(client)
    campaign, prospect, _, draft = aged_conversation(client)
    plan = preview(client).json()
    with db.transaction() as connection:
        if mutation == "notes":
            connection.execute("UPDATE prospects SET notes='changed' WHERE id=?", (prospect,))
        elif mutation == "new_reply":
            connection.execute(
                "INSERT INTO replies(workspace_id,draft_id,body,created_by,received_at,created_at) VALUES (1,?,'new reply',1,?,?)",
                (draft, db.now(), db.now()),
            )
        elif mutation == "reminder_done":
            connection.execute(
                "INSERT INTO reminders(workspace_id,prospect_id,title,due_at,status,created_by,created_at) VALUES (1,?,'Recent completed','2020-01-01','done','user',?)",
                (prospect, db.now()),
            )
        elif mutation == "campaign":
            connection.execute("UPDATE campaigns SET status='active' WHERE id=?", (campaign,))
        elif mutation == "suppression":
            connection.execute(
                "INSERT INTO suppressions(workspace_id,normalized_value,reason,created_by,created_at) VALUES (1,'simbi:https://simbi.com/example','Keep opt-out',1,?)",
                (db.now(),),
            )
        elif mutation == "retention":
            connection.execute("UPDATE workspaces SET retention_days=730")
        elif mutation == "expiry":
            connection.execute("UPDATE privacy_cleanup_plans SET expires_at='2000-01-01'")
    if mutation == "new_preview":
        assert preview(client, prospect).status_code == 200
    assert confirm(client, plan["plan_id"]).status_code == 409
    assert db.fetch_one("SELECT id FROM prospects WHERE id=?", (prospect,))
    assert not list(privacy.settings.backup_path.glob("*.db"))


@pytest.mark.parametrize(
    "protection",
    [
        "active_campaign",
        "recent_reply",
        "open_reminder",
        "ambiguous",
        "prepared",
        "opened",
        "orphan_handoff",
        "orphan_ambiguous",
        "recent_audit",
        "bad_date",
    ],
)
def test_retention_protects_active_recent_and_uncertain_records(client, protection):
    setup_owner(client)
    campaign, prospect, _, draft = aged_conversation(client)
    old = "2020-01-01T00:00:00+00:00"
    with db.transaction() as connection:
        if protection == "active_campaign":
            connection.execute("UPDATE campaigns SET status='active' WHERE id=?", (campaign,))
        elif protection == "recent_reply":
            connection.execute("UPDATE replies SET received_at=?", (db.now(),))
        elif protection == "open_reminder":
            connection.execute(
                "INSERT INTO reminders(workspace_id,prospect_id,title,due_at,created_by,created_at) VALUES (1,?,'Open work',?,'user',?)",
                (prospect, old, old),
            )
        elif protection in {"prepared", "opened", "ambiguous"}:
            connection.execute(
                "INSERT INTO handoffs(workspace_id,draft_id,idempotency_key,provider_url,content_hash,status,prepared_at) VALUES (1,?,'fictional','https://simbi.com/','hash',?,?)",
                (draft, protection, old),
            )
        elif protection == "recent_audit":
            db.audit(connection, 1, 1, "reminder.done", "draft", draft)
        elif protection in {"orphan_handoff", "orphan_ambiguous"}:
            connection.execute(
                "UPDATE drafts SET state=? WHERE id=?",
                ("handoff_created" if protection == "orphan_handoff" else "ambiguous", draft),
            )
        else:
            connection.execute("UPDATE replies SET received_at='not-a-date'")
    response = preview(client)
    assert response.status_code == 200, response.text
    assert response.json()["counts"]["prospects"] == 0
    assert response.json()["protected_contacts"] == 1
    assert confirm(client, response.json()["plan_id"]).status_code == 409
    if protection in {"prepared", "opened", "ambiguous", "orphan_handoff", "orphan_ambiguous"}:
        assert preview(client, prospect).status_code == 409


def test_backup_failure_and_postbackup_failure_do_not_delete(client, monkeypatch):
    setup_owner(client)
    prospect = contact(client)
    plan = preview(client, prospect).json()["plan_id"]
    original = db._snapshot

    def fail_backup(*args):
        raise OSError("fictional full disk")

    monkeypatch.setattr(db, "_snapshot", fail_backup)
    response = confirm(client, plan)
    assert (
        response.status_code == 503 and response.json()["error"]["code"] == "privacy_backup_failed"
    )
    assert db.fetch_one("SELECT id FROM prospects WHERE id=?", (prospect,))
    monkeypatch.setattr(db, "_snapshot", original)
    with db.transaction() as connection:
        connection.execute(
            "CREATE TRIGGER fictional_cleanup_failure BEFORE DELETE ON prospects BEGIN SELECT RAISE(ABORT,'fictional cleanup fault'); END"
        )
    assert confirm(client, plan).status_code == 409
    assert db.fetch_one("SELECT id FROM prospects WHERE id=?", (prospect,))
    assert not db.fetch_one("SELECT id FROM suppressions")
    assert db.fetch_one("SELECT receipt_json FROM privacy_cleanup_plans")["receipt_json"] is None
    assert len(list(privacy.settings.backup_path.glob("*.db"))) == 1


@pytest.mark.parametrize("role", ["viewer", "editor", "admin"])
def test_cleanup_is_owner_only(client, role):
    setup_owner(client)
    prospect = contact(client)
    plan = preview(client, prospect).json()["plan_id"]
    with db.transaction() as connection:
        connection.execute("UPDATE memberships SET role=?", (role,))
    assert preview(client, prospect).status_code == 403
    assert confirm(client, plan).status_code == 403
    assert (
        client.post(
            "/api/settings/retention", headers=csrf_headers(client), json={"retention_days": 90}
        ).status_code
        == 403
    )


def test_password_confirm_csrf_unknown_plan_and_legacy_delete_gates(client):
    setup_owner(client)
    prospect = contact(client)
    assert (
        client.delete(f"/api/prospects/{prospect}", headers=csrf_headers(client)).status_code == 409
    )
    plan = preview(client, prospect).json()["plan_id"]
    assert confirm(client, plan, current_password=INVALID_PASSPHRASE).status_code == 403
    assert confirm(client, plan, confirmed=False).status_code == 422
    assert confirm(client, "a" * 32).status_code == 409
    assert (
        client.post(
            "/api/privacy/confirm",
            json={"plan_id": plan, "current_password": TEST_PASSPHRASE, "confirmed": True},
        ).status_code
        == 403
    )
    assert client.post("/api/privacy/preview", json={"kind": "retention"}).status_code == 403
    for _ in range(main.settings.max_failed_logins):
        confirm(client, plan, current_password=INVALID_PASSPHRASE)
    assert confirm(client, plan).status_code == 429
    assert db.fetch_one("SELECT id FROM prospects WHERE id=?", (prospect,))


def test_rechecks_owner_and_session_inside_transaction(client, monkeypatch):
    setup_owner(client)
    prospect = contact(client)
    plan = preview(client, prospect).json()["plan_id"]
    cached = client.get("/api/me").json()
    main.app.dependency_overrides[main.current_member] = lambda: cached
    try:
        with db.transaction() as connection:
            connection.execute("DELETE FROM sessions")
        assert confirm(client, plan).status_code == 403
    finally:
        main.app.dependency_overrides.clear()


def test_retention_policy_validation_and_no_automatic_delete(client):
    setup_owner(client)
    prospect = contact(client)
    for days in (29, 3651):
        assert (
            client.post(
                "/api/settings/retention",
                headers=csrf_headers(client),
                json={"retention_days": days},
            ).status_code
            == 422
        )
    result = client.post(
        "/api/settings/retention", headers=csrf_headers(client), json={"retention_days": 90}
    )
    assert result.status_code == 200 and result.json()["automatic_personal_data_deletion"] is False
    assert db.fetch_one("SELECT retention_days FROM workspaces")["retention_days"] == 90
    assert db.fetch_one("SELECT id FROM prospects WHERE id=?", (prospect,))
    assert (
        client.post(
            "/api/privacy/preview",
            headers=csrf_headers(client),
            json={"kind": "retention", "prospect_id": prospect},
        ).status_code
        == 422
    )


def test_batch_counts_are_bounded_and_preview_does_not_duplicate_personal_content(client):
    setup_owner(client)
    with db.transaction() as connection:
        for index in range(53):
            connection.execute(
                "INSERT INTO prospects(workspace_id,name,source_url,notes,created_at,updated_at) VALUES (1,?,?,'private text','2020-01-01T00:00:00+00:00','2020-01-01T00:00:00+00:00')",
                (f"Fixture {index}", f"https://simbi.com/fixture-{index}"),
            )
    plan = preview(client).json()
    assert plan["counts"]["prospects"] == 50 and plan["remaining_eligible_contacts"] == 3
    stored = db.fetch_one("SELECT plan_json FROM privacy_cleanup_plans")["plan_json"]
    assert "private text" not in stored and "Fixture" not in stored
    assert len(json.loads(stored)["ids"]) == 50


def test_backup_holds_writer_lock_and_new_contacts_are_not_silently_added(client, monkeypatch):
    setup_owner(client)
    selected = contact(client)
    plan = preview(client, selected).json()["plan_id"]
    untouched = contact(client, "untouched")
    original = db._snapshot

    def checked_snapshot(reader, folder):
        with closing(db.connect()) as writer:
            writer.execute("PRAGMA busy_timeout=0")
            with pytest.raises(sqlite3.OperationalError, match="locked"):
                writer.execute(
                    "UPDATE prospects SET notes='concurrent change' WHERE id=?", (selected,)
                )
        return original(reader, folder)

    monkeypatch.setattr(db, "_snapshot", checked_snapshot)
    assert confirm(client, plan).status_code == 200
    assert (
        db.fetch_one("SELECT notes FROM prospects WHERE id=?", (untouched,))["notes"]
        == "private contact notes"
    )
    receipts = client.get("/api/privacy/receipts").json()["items"]
    assert len(receipts) == 1 and receipts[0]["plan_id"] == plan


def test_foreign_workspace_plans_and_cascade_links_are_protected(client):
    setup_owner(client)
    selected = contact(client)
    plan = preview(client, selected).json()["plan_id"]
    with db.transaction() as connection:
        other_user = connection.execute(
            "INSERT INTO users(email,password_hash,display_name,created_at) VALUES ('other@example.test',?,'Other owner',?)",
            (hash_password(TEST_PASSPHRASE), db.now()),
        ).lastrowid
        other_workspace = connection.execute(
            "INSERT INTO workspaces(name,created_at) VALUES ('Other private workspace',?)",
            (db.now(),),
        ).lastrowid
        connection.execute(
            "INSERT INTO memberships(user_id,workspace_id,role) VALUES (?,?,'owner')",
            (other_user, other_workspace),
        )
        connection.execute(
            "INSERT INTO suppressions(workspace_id,prospect_id,normalized_value,reason,created_by,created_at) VALUES (?,?,'other:identity','Foreign record',?,?)",
            (other_workspace, selected, other_user, db.now()),
        )
    assert preview(client, selected).status_code == 409
    assert confirm(client, plan).status_code == 409
    client.post("/api/auth/logout", headers=csrf_headers(client), json={})
    assert (
        client.post(
            "/api/auth/login", json={"email": "other@example.test", "password": TEST_PASSPHRASE}
        ).status_code
        == 200
    )
    assert preview(client, selected).status_code == 404
    assert confirm(client, plan).status_code == 409
    assert client.get("/api/privacy/receipts").json()["items"] == []
    assert db.fetch_one("SELECT prospect_id FROM suppressions")["prospect_id"] == selected


def test_scan_limit_reports_failure_instead_of_an_incomplete_zero_count(client, monkeypatch):
    setup_owner(client)
    selected = contact(client)
    with db.transaction() as connection:
        connection.execute(
            "UPDATE prospects SET updated_at='2020-01-01T00:00:00+00:00' WHERE id=?", (selected,)
        )
    monkeypatch.setattr(privacy, "SCAN_LIMIT", 0)
    result = preview(client)
    assert result.status_code == 409 and result.json()["error"]["code"] == "privacy_scan_limit"
    assert not db.fetch_one("SELECT id FROM privacy_cleanup_plans")
