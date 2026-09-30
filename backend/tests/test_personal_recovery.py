from __future__ import annotations

import sqlite3
import warnings
from contextlib import closing
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from app import cli, db, windows
from app.main import app
from app.recovery import recover_owner_password
from app.security import hash_password, token_hash, verify_password
from fastapi.testclient import TestClient

OLD_PASSPHRASE = "old local owner test passphrase"  # noqa: S105 - isolated test credentials
NEW_PASSPHRASE = "new local owner test passphrase"  # noqa: S105 - isolated test credentials


@pytest.fixture
def personal_store(tmp_path, monkeypatch):
    config = replace(
        db.settings, database_path=tmp_path / "personal.db", backup_path=tmp_path / "backups"
    )
    monkeypatch.setattr(db, "settings", config)
    monkeypatch.setattr(cli, "settings", config)
    db.migrate()
    with db.transaction() as connection:
        for user_id, role in [(1, "owner"), (2, "viewer")]:
            connection.execute(
                "INSERT INTO users VALUES (?,?,?,?,?)",
                (user_id, f"{role}@example.test", hash_password(OLD_PASSPHRASE), role, db.now()),
            )
        connection.execute(
            "INSERT INTO workspaces(id,name,created_at) VALUES (1,'Personal',?)", (db.now(),)
        )
        connection.executemany(
            "INSERT INTO memberships VALUES (?,1,?)", [(1, "owner"), (2, "viewer")]
        )
        expires = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
        connection.executemany(
            "INSERT INTO sessions VALUES (?,?,?,?)",
            [
                (token_hash("owner-session"), 1, expires, db.now()),
                (token_hash("viewer-session"), 2, expires, db.now()),
            ],
        )
    return config


def test_recovery_preserves_records_backups_old_login_and_revokes_only_owner(personal_store):
    timestamp = db.now()
    with db.transaction() as connection:
        connection.execute(
            "INSERT INTO campaigns(id,workspace_id,name,purpose,lawful_basis,created_at,updated_at) "
            "VALUES (1,1,'Personal campaign','Preserve existing work','Manual context',?,?)",
            (timestamp, timestamp),
        )
        connection.execute(
            "INSERT INTO prospects(id,workspace_id,name,source_url,created_at,updated_at) "
            "VALUES (1,1,'Fixture prospect','https://simbi.com/',?,?)",
            (timestamp, timestamp),
        )
        connection.execute(
            "INSERT INTO drafts(workspace_id,campaign_id,prospect_id,body,quality_score,created_at,updated_at) "
            "VALUES (1,1,1,'Retained local draft',50,?,?)",
            (timestamp, timestamp),
        )
    records_before = {
        table: db.fetch_all(f"SELECT * FROM {table} ORDER BY id")
        for table in ("campaigns", "prospects", "drafts")
    }
    backup = recover_owner_password(" Owner@example.test ", NEW_PASSPHRASE)
    with closing(sqlite3.connect(backup)) as before:
        assert verify_password(
            OLD_PASSPHRASE,
            before.execute("SELECT password_hash FROM users WHERE id=1").fetchone()[0],
        )
        assert before.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 2
        assert before.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert db.fetch_one("SELECT COUNT(*) AS n FROM workspaces")["n"] == 1
    assert db.fetch_one("SELECT COUNT(*) AS n FROM users")["n"] == 2
    assert db.fetch_one("SELECT COUNT(*) AS n FROM memberships")["n"] == 2
    for table, before in records_before.items():
        assert db.fetch_all(f"SELECT * FROM {table} ORDER BY id") == before
    assert db.fetch_one("SELECT user_id FROM sessions")["user_id"] == 2
    event = db.fetch_one(
        "SELECT * FROM audit_events WHERE event_type='account.owner_password_recovered'"
    )
    assert event["actor_user_id"] is None
    assert event["entity_id"] == "1"
    assert NEW_PASSPHRASE not in event["details"]
    with TestClient(app) as client:
        client.cookies.set("simbi_session", "owner-session")
        assert client.get("/api/me").status_code == 401
        assert (
            client.post(
                "/api/auth/login", json={"email": "owner@example.test", "password": OLD_PASSPHRASE}
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/api/auth/login", json={"email": "owner@example.test", "password": NEW_PASSPHRASE}
            ).status_code
            == 200
        )
        assert client.get("/api/me").json()["role"] == "owner"


@pytest.mark.parametrize(
    "email,phrase",
    [
        ("viewer@example.test", NEW_PASSPHRASE),
        ("missing@example.test", NEW_PASSPHRASE),
        ("bad email", NEW_PASSPHRASE),
        ("owner@example.test", "short"),
        ("owner@example.test", "a" * 201),
    ],
)
def test_recovery_refuses_invalid_target_or_password_without_changes(personal_store, email, phrase):
    with pytest.raises(ValueError):
        recover_owner_password(email, phrase)
    assert verify_password(
        OLD_PASSPHRASE, db.fetch_one("SELECT password_hash FROM users WHERE id=1")["password_hash"]
    )
    assert db.fetch_one("SELECT COUNT(*) AS n FROM sessions")["n"] == 2
    assert not list(personal_store.backup_path.glob("*.db"))


def test_recovery_refuses_running_app_and_backup_failure(personal_store, monkeypatch):
    with db.runtime_guard(), pytest.raises(RuntimeError, match="busy"):
        recover_owner_password("owner@example.test", NEW_PASSPHRASE)

    def fail_snapshot(*_args):
        raise OSError("backup destination unavailable")

    monkeypatch.setattr(db, "_snapshot", fail_snapshot)
    with pytest.raises(OSError, match="backup destination"):
        recover_owner_password("owner@example.test", NEW_PASSPHRASE)
    assert verify_password(
        OLD_PASSPHRASE, db.fetch_one("SELECT password_hash FROM users WHERE id=1")["password_hash"]
    )
    assert db.fetch_one("SELECT COUNT(*) AS n FROM sessions")["n"] == 2


def test_recovery_rolls_back_password_if_audit_fails(personal_store, monkeypatch):
    def fail_audit(*_args):
        raise sqlite3.OperationalError("audit unavailable")

    monkeypatch.setattr(db, "audit", fail_audit)
    with pytest.raises(sqlite3.Error, match="audit unavailable"):
        recover_owner_password("owner@example.test", NEW_PASSPHRASE)
    assert verify_password(
        OLD_PASSPHRASE, db.fetch_one("SELECT password_hash FROM users WHERE id=1")["password_hash"]
    )
    assert db.fetch_one("SELECT COUNT(*) AS n FROM sessions")["n"] == 2


def test_recovery_refuses_multiple_workspaces_and_missing_database(personal_store):
    db.execute("INSERT INTO workspaces(name,created_at) VALUES ('Other',?)", (db.now(),))
    with pytest.raises(ValueError, match="one personal"):
        recover_owner_password("owner@example.test", NEW_PASSPHRASE)
    personal_store.database_path.unlink()
    with pytest.raises(ValueError, match="No existing database"):
        recover_owner_password("owner@example.test", NEW_PASSPHRASE)
    assert not personal_store.database_path.exists()


def test_cli_requires_confirmation_and_hidden_matching_input(personal_store, monkeypatch, capsys):
    def no_prompt(_prompt):
        raise AssertionError("unconfirmed recovery must not prompt")

    monkeypatch.setattr(cli.getpass, "getpass", no_prompt)
    assert cli.recover_password("owner@example.test", False) == 2

    def visible_fallback(_prompt):
        warnings.warn("cannot hide input", cli.getpass.GetPassWarning, stacklevel=2)

    monkeypatch.setattr(cli.getpass, "getpass", visible_fallback)
    assert cli.recover_password("owner@example.test", True) == 2
    responses = iter([NEW_PASSPHRASE, "mismatched confirmation"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda _prompt: next(responses))
    assert cli.recover_password("owner@example.test", True) == 2
    responses = iter([NEW_PASSPHRASE, NEW_PASSPHRASE])
    monkeypatch.setattr(cli.getpass, "getpass", lambda _prompt: next(responses))
    assert cli.recover_password("owner@example.test", True) == 0
    assert NEW_PASSPHRASE not in capsys.readouterr().out


def test_recovery_is_local_only(personal_store, monkeypatch):
    monkeypatch.setattr(db, "settings", replace(personal_store, environment="production"))
    with pytest.raises(ValueError, match="local personal"):
        recover_owner_password("owner@example.test", NEW_PASSPHRASE)
    monkeypatch.setattr(cli, "settings", replace(personal_store, environment="production"))
    assert cli.recover_password("owner@example.test", True) == 2


def test_windows_commands_do_not_launch_server(monkeypatch):
    called = []
    monkeypatch.setattr(cli, "main", lambda argv: called.append(argv))
    monkeypatch.setattr(windows, "_configure", lambda: ("127.0.0.1", 8765))
    windows.main(["backup", "--destination", "example folder"])
    assert called == [["backup", "--destination", "example folder"]]


def test_doctor_accepts_packaged_interface_without_source_manifest(
    personal_store, tmp_path, monkeypatch, capsys
):
    interface = tmp_path / "frontend" / "dist"
    interface.mkdir(parents=True)
    (interface / "index.html").write_text("<html></html>", encoding="utf-8")
    monkeypatch.setattr(cli, "ROOT", tmp_path)
    assert cli.doctor() == 0
    assert "compiled interface present" in capsys.readouterr().out
