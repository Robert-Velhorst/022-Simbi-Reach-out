from __future__ import annotations

import shutil
import sqlite3
import subprocess
import sys
from contextlib import closing
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest
from app import cli, db


def test_missing_migration_assets_fail_closed(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "ROOT", tmp_path / "missing-assets")
    with pytest.raises(RuntimeError, match="migration assets"):
        db.migrate()


@pytest.fixture(autouse=True)
def isolated_database(tmp_path, monkeypatch):
    settings = replace(
        db.settings, database_path=tmp_path / "live.db", backup_path=tmp_path / "backups"
    )
    monkeypatch.setattr(db, "settings", settings)
    monkeypatch.setattr(cli, "settings", settings)
    return settings


def add_user(email="before@example.test"):
    db.execute(
        "INSERT INTO users(email,password_hash,display_name,created_at) VALUES (?,?,?,?)",
        (email, "test-only-hash", "Before", db.now()),
    )


def user_emails(path):
    with closing(sqlite3.connect(path)) as connection:
        return [row[0] for row in connection.execute("SELECT email FROM users ORDER BY id")]


def test_migration_failure_rolls_back_schema_data_and_ledger(tmp_path, monkeypatch):
    db.migrate()
    migration_dir = tmp_path / "backend" / "migrations"
    migration_dir.mkdir(parents=True)
    (migration_dir / "999_failure.sql").write_text(
        "CREATE TABLE partial_change(value TEXT); INSERT INTO partial_change VALUES ('x');"
        "INSERT INTO table_that_does_not_exist VALUES (1);",
        encoding="utf-8",
    )
    monkeypatch.setattr(db, "ROOT", tmp_path)
    with pytest.raises(sqlite3.Error):
        db.migrate()
    assert db.fetch_one("SELECT name FROM sqlite_master WHERE name='partial_change'") is None
    assert db.fetch_one("SELECT name FROM schema_migrations WHERE name='999_failure.sql'") is None


def test_backup_names_do_not_overwrite_same_second(isolated_database, monkeypatch):
    class FrozenDatetime:
        @staticmethod
        def now(_):
            return datetime(2026, 9, 5, tzinfo=UTC)

    monkeypatch.setattr(db, "datetime", FrozenDatetime)
    db.migrate()
    add_user()
    first = db.create_backup()
    add_user("after@example.test")
    second = db.create_backup()
    assert first != second
    assert user_emails(first) == ["before@example.test"]
    assert user_emails(second) == ["before@example.test", "after@example.test"]


@pytest.mark.parametrize(
    "invalid",
    ["corrupt", "ledger_only", "missing_table", "unknown_migration", "unexpected_trigger"],
)
def test_restore_rejects_invalid_source_and_preserves_target(tmp_path, invalid, isolated_database):
    db.migrate()
    add_user()
    source = tmp_path / "candidate.db"
    if invalid == "corrupt":
        source.write_bytes(b"not a sqlite database")
    elif invalid == "ledger_only":
        with closing(sqlite3.connect(source)) as connection:
            connection.execute("CREATE TABLE schema_migrations(name TEXT, applied_at TEXT)")
            connection.commit()
    else:
        source = db.create_backup(tmp_path / "source")
        with closing(sqlite3.connect(source)) as connection:
            if invalid == "missing_table":
                connection.execute("DROP TABLE users")
            elif invalid == "unexpected_trigger":
                connection.execute(
                    "CREATE TRIGGER sqlitexhidden AFTER UPDATE ON users BEGIN SELECT 1; END;"
                )
            else:
                connection.execute("INSERT INTO schema_migrations VALUES ('999_future.sql','now')")
            connection.commit()
    assert cli.restore(str(source), True) == 2
    assert user_emails(isolated_database.database_path) == ["before@example.test"]


def test_restore_refuses_active_managed_connection(tmp_path, isolated_database):
    db.migrate()
    add_user()
    source = db.create_backup(tmp_path / "source")
    add_user("after@example.test")
    with closing(db.connect()):
        assert cli.restore(str(source), True) == 2
    assert user_emails(isolated_database.database_path) == [
        "before@example.test",
        "after@example.test",
    ]


def test_restore_refuses_idle_runtime(tmp_path, isolated_database):
    guard = getattr(db, "runtime_guard", None)
    assert callable(guard), "Runtime must hold an OS lease even between database requests"
    db.migrate()
    source = db.create_backup(tmp_path / "source")
    add_user()
    with guard():
        assert cli.restore(str(source), True) == 2
    assert user_emails(isolated_database.database_path) == ["before@example.test"]


def test_restore_uses_committed_wal_and_keeps_pre_restore_backup(tmp_path, isolated_database):
    db.migrate()
    add_user()
    source = db.create_backup(tmp_path / "source")
    with closing(sqlite3.connect(source)) as candidate:
        candidate.execute("PRAGMA journal_mode=WAL")
        candidate.execute("UPDATE users SET email='wal@example.test'")
        candidate.commit()
        add_user("after@example.test")
        assert Path(str(source) + "-wal").is_file()
        assert cli.restore(str(source), True) == 0
    assert user_emails(isolated_database.database_path) == ["wal@example.test"]
    backups = list(isolated_database.backup_path.glob("simbi-*.db"))
    assert len(backups) == 1
    assert user_emails(backups[0]) == ["before@example.test", "after@example.test"]


def test_restore_migration_failure_leaves_target_unchanged(
    tmp_path, monkeypatch, isolated_database
):
    db.migrate()
    add_user()
    source = db.create_backup(tmp_path / "source")
    add_user("after@example.test")
    migration_dir = tmp_path / "backend" / "migrations"
    shutil.copytree(db.ROOT / "backend" / "migrations", migration_dir)
    (migration_dir / "999_failure.sql").write_text(
        "CREATE TABLE partial_change(value TEXT); SELECT * FROM missing_table;", encoding="utf-8"
    )
    monkeypatch.setattr(db, "ROOT", tmp_path)
    assert cli.restore(str(source), True) == 2
    assert user_emails(isolated_database.database_path) == [
        "before@example.test",
        "after@example.test",
    ]
    assert db.fetch_one("SELECT name FROM sqlite_master WHERE name='partial_change'") is None


def test_restore_same_database_is_rejected(isolated_database):
    db.migrate()
    add_user()
    assert cli.restore(str(isolated_database.database_path), True) == 2
    assert user_emails(isolated_database.database_path) == ["before@example.test"]


def test_restore_refuses_external_writer_without_partial_replacement(tmp_path, isolated_database):
    db.migrate()
    add_user()
    source = db.create_backup(tmp_path / "source")
    add_user("after@example.test")
    with closing(sqlite3.connect(isolated_database.database_path)) as writer:
        writer.execute("BEGIN IMMEDIATE")
        writer.execute("UPDATE users SET display_name='Pending write'")
        assert cli.restore(str(source), True) == 2
        writer.rollback()
    assert user_emails(isolated_database.database_path) == [
        "before@example.test",
        "after@example.test",
    ]


def test_restore_can_initialize_missing_target(tmp_path, isolated_database):
    db.migrate()
    add_user()
    source = db.create_backup(tmp_path / "source")
    isolated_database.database_path.unlink()
    assert cli.restore(str(source), True) == 0
    assert user_emails(isolated_database.database_path) == ["before@example.test"]


def test_restore_upgrades_supported_older_backup(tmp_path, monkeypatch, isolated_database):
    migration_dir = tmp_path / "old" / "backend" / "migrations"
    migration_dir.mkdir(parents=True)
    shutil.copy2(db.ROOT / "backend" / "migrations" / "001_initial.sql", migration_dir)
    with monkeypatch.context() as old_release:
        old_release.setattr(db, "ROOT", tmp_path / "old")
        db.migrate()
        add_user()
        source = db.create_backup(tmp_path / "source")
    db.migrate()
    add_user("after@example.test")
    assert cli.restore(str(source), True) == 0
    assert user_emails(isolated_database.database_path) == ["before@example.test"]
    assert db.fetch_one(
        "SELECT name FROM schema_migrations WHERE name='002_production_hardening.sql'"
    )
    with closing(sqlite3.connect(source)) as original:
        assert original.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0] == 1


def test_runtime_lease_excludes_other_process_and_releases_on_exit(isolated_database):
    lock_path = Path(str(isolated_database.database_path.resolve()) + ".runtime.lock")
    code = (
        "from pathlib import Path\n"
        "from app.db import file_lock\n"
        "import sys\n"
        "try:\n"
        "    with file_lock(Path(sys.argv[1])): pass\n"
        "except RuntimeError:\n"
        "    sys.exit(23)\n"
    )

    def contender():
        return subprocess.run(  # noqa: S603 - fixed interpreter and code, isolated test path only
            [sys.executable, "-c", code, str(lock_path)],
            cwd=db.ROOT / "backend",
            capture_output=True,
            timeout=10,
            check=False,
        )

    with db.runtime_guard():
        with db.runtime_guard():
            result = contender()
            assert result.returncode == 23, result.stderr
    result = contender()
    assert result.returncode == 0, result.stderr


def test_migrations_preserve_trigger_bodies_and_quoted_semicolons(tmp_path, monkeypatch):
    migration_dir = tmp_path / "backend" / "migrations"
    migration_dir.mkdir(parents=True)
    (migration_dir / "001_trigger.sql").write_text(
        "CREATE TABLE input(value TEXT); CREATE TABLE output(value TEXT);"
        "CREATE TRIGGER append_value AFTER INSERT ON input BEGIN "
        "INSERT INTO output VALUES ('prefix;' || NEW.value); "
        "INSERT INTO output VALUES ('second'); END;"
        "INSERT INTO input VALUES ('test;value'); -- trailing comment\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(db, "ROOT", tmp_path)
    assert db.migrate() == ["001_trigger.sql"]
    assert db.fetch_all("SELECT value FROM output") == [
        {"value": "prefix;test;value"},
        {"value": "second"},
    ]
    assert db.migrate() == []


def test_migrations_cannot_commit_around_the_ledger(tmp_path, monkeypatch):
    migration_dir = tmp_path / "backend" / "migrations"
    migration_dir.mkdir(parents=True)
    (migration_dir / "001_commit.sql").write_text(
        "CREATE TABLE partial_change(value TEXT); COMMIT;", encoding="utf-8"
    )
    monkeypatch.setattr(db, "ROOT", tmp_path)
    with pytest.raises(sqlite3.DatabaseError):
        db.migrate()
    assert db.fetch_one("SELECT name FROM sqlite_master WHERE name='partial_change'") is None
