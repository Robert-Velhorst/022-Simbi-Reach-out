from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from dataclasses import replace

import pytest
from app import db, hai, main, privacy, retirement, worker
from conftest import csrf_headers, setup_owner
from test_privacy_cleanup import INVALID_PASSPHRASE, TEST_PASSPHRASE, aged_conversation


def pause(client):
    assert (
        client.post(
            "/api/settings/pause", headers=csrf_headers(client), json={"paused": True}
        ).status_code
        == 200
    )


def preview(client):
    return client.post("/api/privacy/retirement/preview", headers=csrf_headers(client), json={})


def confirm(client, plan_id, **changes):
    return client.post(
        "/api/privacy/retirement/confirm",
        headers=csrf_headers(client),
        json={
            "plan_id": plan_id,
            "current_password": TEST_PASSPHRASE,
            "confirmed": True,
            "acknowledged_loss": True,
            "typed_confirmation": "RETIRE",
            **changes,
        },
    )


def prepared(client):
    setup_owner(client)
    aged_conversation(client)
    with db.transaction() as connection:
        connection.execute(
            "INSERT INTO suppressions(workspace_id,prospect_id,normalized_value,reason,created_by,created_at) VALUES (1,1,'simbi:private','private reason',1,?)",
            (db.now(),),
        )
        connection.execute(
            "INSERT INTO analytics_events(workspace_id,event_type,created_at) VALUES (1,'private',?)",
            (db.now(),),
        )
        connection.execute(
            "INSERT INTO feature_flags(workspace_id,name,updated_at) VALUES (1,'private',?)",
            (db.now(),),
        )
    pause(client)
    response = preview(client)
    assert response.status_code == 200, response.text
    return response.json()


def test_retirement_exact_counts_backup_cookie_revocation_and_restart_protection(client):
    plan = prepared(client)
    original_session = client.cookies.get("simbi_session")
    with closing(db.connect()) as connection:
        for table, count in plan["counts"].items():
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == count
        stored = connection.execute("SELECT plan_json FROM privacy_cleanup_plans").fetchone()[0]
        assert "Test Owner" not in stored and "private" not in stored
    response = confirm(client, plan["plan_id"])
    assert response.status_code == 200, response.text
    receipt = response.json()
    assert receipt["counts"] == plan["counts"]
    assert not client.cookies.get("simbi_session") and not client.cookies.get("simbi_csrf")
    backups = list(privacy.settings.backup_path.glob("*.db"))
    assert len(backups) == 1 and backups[0].name == receipt["backup_file"]
    with closing(sqlite3.connect(backups[0])) as recovery:
        recovery.row_factory = sqlite3.Row
        db._validate_schema(recovery)
        assert recovery.execute("SELECT paused_at FROM workspaces").fetchone()[0]
        assert recovery.execute("SELECT COUNT(*) FROM installation_retirement").fetchone()[0] == 0
        for table, count in plan["counts"].items():
            assert recovery.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == count
    with closing(db.connect()) as connection:
        for table in retirement.TABLES:
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
        marker = connection.execute("SELECT receipt_json FROM installation_retirement").fetchone()[
            0
        ]
        assert (
            "private reason" not in marker
            and "owner@example.test" not in marker
            and "Test Workspace" not in marker
        )
    # Verify the real restore mechanism against an isolated COPY, not the live fixture.
    recovery_target = backups[0].parent / "restored-copy.db"
    original_settings = db.settings
    try:
        db.settings = replace(
            db.settings,
            database_path=recovery_target,
            backup_path=backups[0].parent / "copy-backups",
        )
        db.restore_backup(backups[0])
        with closing(db.connect()) as restored:
            assert restored.execute("SELECT paused_at FROM workspaces").fetchone()[0]
            assert restored.execute("SELECT COUNT(*) FROM suppressions").fetchone()[0] == 1
            assert not retirement.is_retired(restored)
    finally:
        db.settings = original_settings
    status = client.get("/api/auth/status").json()
    assert status["installation_retired"] and not status["setup_required"]
    assert "backup_file" not in status and "plan_id" not in status
    client.cookies.set("simbi_session", original_session)
    assert client.get("/api/me").status_code == 401
    client.cookies.clear()
    login = client.post(
        "/api/auth/login", json={"email": "owner@example.test", "password": TEST_PASSPHRASE}
    )
    assert login.status_code == 409 and login.json()["error"]["code"] == "installation_retired"
    bootstrap = client.post(
        "/api/auth/setup",
        json={
            "email": "new@example.test",
            "password": TEST_PASSPHRASE,
            "display_name": "New Owner",
            "workspace_name": "New Space",
        },
    )
    assert bootstrap.status_code == 409
    main.record_login_failure("retired-race-fingerprint")
    assert db.fetch_one("SELECT COUNT(*) AS n FROM login_attempts")["n"] == 0
    assert client.get("/api/privacy/retirement/receipt/" + "0" * 32).status_code == 404
    replay = client.get("/api/privacy/retirement/receipt/" + plan["plan_id"])
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert (
        replay.json()["counts"] == plan["counts"]
        and len(list(privacy.settings.backup_path.glob("simbi-*.db"))) == 1
    )
    assert client.post("/api/privacy/retirement/confirm", json={}).status_code in {401, 403}


def test_safety_stop_and_shared_installation_are_protected(client):
    setup_owner(client)
    assert preview(client).json()["error"]["code"] == "retirement_pause_required"
    pause(client)
    assert (
        client.post(
            "/api/settings/team",
            headers=csrf_headers(client),
            json={
                "email": "viewer@example.test",
                "display_name": "Viewer",
                "password": TEST_PASSPHRASE,
                "role": "viewer",
            },
        ).status_code
        == 201
    )
    response = preview(client)
    assert (
        response.status_code == 409
        and response.json()["error"]["code"] == "retirement_personal_only"
    )
    assert db.fetch_one("SELECT COUNT(*) AS n FROM users")["n"] == 2
    assert not list(privacy.settings.backup_path.glob("*.db"))


@pytest.mark.parametrize(
    "table,column,value", [("drafts", "state", "ambiguous"), ("drafts", "state", "handoff_created")]
)
def test_unresolved_outreach_protected(client, table, column, value):
    prepared(client)
    with db.transaction() as connection:
        connection.execute(f"UPDATE {table} SET {column}=?", (value,))
    assert preview(client).json()["error"]["code"] == "privacy_in_flight"


@pytest.mark.parametrize(
    "change", ["contact", "session", "restriction", "resume", "new_preview", "expiry"]
)
def test_preview_stale_never_deletes(client, change):
    plan = prepared(client)
    if change == "new_preview":
        assert preview(client).status_code == 200
    else:
        sql = {
            "contact": "UPDATE prospects SET notes='changed'",
            "session": "UPDATE sessions SET expires_at='2099-01-01T00:00:00+00:00'",
            "restriction": "UPDATE suppressions SET reason='changed'",
            "resume": "UPDATE workspaces SET paused_at=NULL",
            "expiry": "UPDATE privacy_cleanup_plans SET expires_at='2020-01-01T00:00:00+00:00'",
        }[change]
        with db.transaction() as connection:
            connection.execute(sql)
    response = confirm(client, plan["plan_id"])
    assert response.status_code == 409, response.text
    assert db.fetch_one("SELECT COUNT(*) AS n FROM users")["n"] == 1
    assert not list(privacy.settings.backup_path.glob("*.db"))


@pytest.mark.parametrize(
    "change",
    [
        {"confirmed": False},
        {"acknowledged_loss": False},
        {"typed_confirmation": "DELETE"},
        {"extra": True},
    ],
)
def test_confirmation_acknowledgements_cannot_be_bypassed(client, change):
    plan = prepared(client)
    assert confirm(client, plan["plan_id"], **change).status_code == 422
    assert db.fetch_one("SELECT COUNT(*) AS n FROM users")["n"] == 1


def test_current_password_and_separate_confirmation_required(client):
    plan = prepared(client)
    assert confirm(client, plan["plan_id"], current_password=INVALID_PASSPHRASE).status_code == 403
    assert confirm(client, plan["plan_id"]).json()["error"]["code"] == "privacy_preview_changed"
    fresh = preview(client).json()
    normal = client.post(
        "/api/privacy/confirm",
        headers=csrf_headers(client),
        json={"plan_id": fresh["plan_id"], "current_password": TEST_PASSPHRASE, "confirmed": True},
    )
    assert normal.json()["error"]["code"] == "retirement_confirmation_required"
    assert confirm(client, fresh["plan_id"]).status_code == 200


def test_backup_failure_rolls_back_and_same_preview_retries(client, monkeypatch):
    plan = prepared(client)
    original = db._snapshot

    def broken(*_):
        raise OSError("fixture backup failure")

    monkeypatch.setattr(db, "_snapshot", broken)
    response = confirm(client, plan["plan_id"])
    assert (
        response.status_code == 503 and response.json()["error"]["code"] == "privacy_backup_failed"
    )
    assert db.fetch_one("SELECT COUNT(*) AS n FROM prospects")["n"] == 1
    assert not db.fetch_one("SELECT * FROM installation_retirement")
    monkeypatch.setattr(db, "_snapshot", original)
    assert confirm(client, plan["plan_id"]).status_code == 200


def test_rollback_after_backup_preserves_records(client, monkeypatch):
    plan = prepared(client)
    original = retirement.encoded

    def fail_receipt(value):
        if isinstance(value, dict) and value.get("completed_at"):
            raise privacy.PrivacyError(503, "fixture_failure", "Isolated post-backup failure")
        return original(value)

    monkeypatch.setattr(retirement, "encoded", fail_receipt)
    assert confirm(client, plan["plan_id"]).status_code == 503
    assert db.fetch_one("SELECT COUNT(*) AS n FROM users")["n"] == 1
    assert db.fetch_one("SELECT COUNT(*) AS n FROM suppressions")["n"] == 1
    assert not db.fetch_one("SELECT * FROM installation_retirement")
    monkeypatch.setattr(retirement, "encoded", original)
    assert confirm(client, plan["plan_id"]).status_code == 200


def test_maintenance_export_serialized_and_retired_worker_never_prunes_or_exports(
    client, monkeypatch, tmp_path
):
    plan = prepared(client)
    with db.maintenance_operation_guard():
        response = confirm(client, plan["plan_id"])
        assert (
            response.status_code == 503
            and response.json()["error"]["code"] == "retirement_maintenance_busy"
        )
        assert worker.run_once() == {"maintenance_skipped": 1}
        with pytest.raises(db.MaintenanceBusy):
            hai.export_hai_feed(tmp_path / "feed.json")
    assert confirm(client, plan["plan_id"]).status_code == 200
    monkeypatch.setattr(
        worker,
        "settings",
        replace(
            worker.settings,
            auto_backup=True,
            backup_path=privacy.settings.backup_path,
            hai_feed_path=tmp_path / "feed.json",
        ),
    )
    result = worker.run_once()
    assert all(count == 0 for count in result.values())
    assert len(list(privacy.settings.backup_path.glob("*.db"))) == 1
    assert not (tmp_path / "feed.json").exists()
    assert db.fetch_one("SELECT value FROM maintenance_state WHERE name='last_maintenance_success'")


def test_unknown_schema_and_oversize_fail_closed(client, monkeypatch):
    prepared(client)
    monkeypatch.setattr(retirement, "ROW_LIMIT", 1)
    assert preview(client).json()["error"]["code"] == "retirement_scan_limit"
    with db.transaction() as connection:
        connection.execute("CREATE TABLE unknown_private_content(value TEXT)")
    assert preview(client).json()["error"]["code"] == "retirement_schema_unknown"


def test_retirement_viewer_and_csrf_boundaries(client):
    plan = prepared(client)
    assert client.post("/api/privacy/retirement/confirm", json={}).status_code == 403
    with db.transaction() as connection:
        connection.execute("UPDATE memberships SET role='viewer'")
    assert preview(client).status_code == 403
    assert confirm(client, plan["plan_id"]).status_code == 403


def test_preview_payload_has_no_stored_private_identity(client):
    plan = prepared(client)
    assert plan["owner_name"] == "Test Owner" and plan["workspace_name"] == "Test Workspace"
    saved = json.loads(db.fetch_one("SELECT plan_json FROM privacy_cleanup_plans")["plan_json"])
    assert set(saved) == {"kind", "counts", "digest"}
