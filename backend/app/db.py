from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import ROOT, settings


def now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def connect() -> sqlite3.Connection:
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(settings.database_path, timeout=10, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    connection = connect()
    try:
        connection.execute("BEGIN IMMEDIATE")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def migrate() -> list[str]:
    applied: list[str] = []
    with transaction() as connection:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        known = {row["name"] for row in connection.execute("SELECT name FROM schema_migrations")}
        migration_dir = ROOT / "backend" / "migrations"
        for path in sorted(migration_dir.glob("*.sql")):
            if path.name in known:
                continue
            connection.executescript(path.read_text(encoding="utf-8"))
            connection.execute(
                "INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)",
                (path.name, now()),
            )
            applied.append(path.name)
    return applied


def fetch_one(sql: str, parameters: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    connection = connect()
    try:
        row = connection.execute(sql, parameters).fetchone()
        return dict(row) if row else None
    finally:
        connection.close()


def fetch_all(sql: str, parameters: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    connection = connect()
    try:
        return [dict(row) for row in connection.execute(sql, parameters).fetchall()]
    finally:
        connection.close()


def execute(sql: str, parameters: tuple[Any, ...] = ()) -> int:
    with transaction() as connection:
        cursor = connection.execute(sql, parameters)
        return int(cursor.lastrowid or 0)


def audit(
    connection: sqlite3.Connection,
    workspace_id: int,
    actor_user_id: int | None,
    event_type: str,
    entity_type: str,
    entity_id: int | str,
    details: dict[str, Any] | None = None,
) -> None:
    connection.execute(
        "INSERT INTO audit_events "
        "(workspace_id, actor_user_id, event_type, entity_type, entity_id, details, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            workspace_id,
            actor_user_id,
            event_type,
            entity_type,
            str(entity_id),
            json.dumps(details or {}, separators=(",", ":"), sort_keys=True),
            now(),
        ),
    )


def database_size() -> int:
    path = Path(settings.database_path)
    return path.stat().st_size if path.exists() else 0


def create_backup(destination: Path | None = None) -> Path:
    migrate()
    folder = (destination or settings.backup_path).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"simbi-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.db"
    source = connect()
    try:
        output = sqlite3.connect(target)
        try:
            source.backup(output)
            integrity = output.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise sqlite3.DatabaseError("Backup integrity check failed")
        finally:
            output.close()
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        source.close()
    return target
