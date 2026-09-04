from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from collections.abc import Iterator
from contextlib import closing, contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import ROOT, settings

MIGRATION_TABLE = (
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
)


@contextmanager
def file_lock(path: Path, *, exclusive: bool = True) -> Iterator[None]:
    """Nonblocking OS lease; never unlink lock files (that would split the lock)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        if os.name == "nt":
            import ctypes
            import msvcrt
            from ctypes import wintypes

            class Overlapped(ctypes.Structure):
                _fields_ = [
                    ("Internal", ctypes.c_size_t),
                    ("InternalHigh", ctypes.c_size_t),
                    ("Offset", wintypes.DWORD),
                    ("OffsetHigh", wintypes.DWORD),
                    ("hEvent", wintypes.HANDLE),
                ]

            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.LockFileEx.argtypes = [
                wintypes.HANDLE,
                wintypes.DWORD,
                wintypes.DWORD,
                wintypes.DWORD,
                wintypes.DWORD,
                ctypes.POINTER(Overlapped),
            ]
            kernel.LockFileEx.restype = wintypes.BOOL
            kernel.UnlockFileEx.argtypes = [
                wintypes.HANDLE,
                wintypes.DWORD,
                wintypes.DWORD,
                wintypes.DWORD,
                ctypes.POINTER(Overlapped),
            ]
            kernel.UnlockFileEx.restype = wintypes.BOOL
            native = msvcrt.get_osfhandle(handle.fileno())
            overlap = Overlapped()
            if not kernel.LockFileEx(
                native, 1 | (2 if exclusive else 0), 0, 1, 0, ctypes.byref(overlap)
            ):
                raise RuntimeError(f"Database runtime is busy; stop the app and worker: {path}")
            try:
                yield
            finally:
                kernel.UnlockFileEx(native, 0, 1, 0, ctypes.byref(overlap))
        else:
            import fcntl

            try:
                fcntl.flock(handle, (fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH) | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise RuntimeError(
                    f"Database runtime is busy; stop the app and worker: {path}"
                ) from exc
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)


def runtime_guard():
    """Hold throughout app/worker lifetime, including idle intervals."""
    return file_lock(Path(str(settings.database_path.resolve()) + ".runtime.lock"), exclusive=False)


class _GuardedConnection(sqlite3.Connection):
    _runtime_lease = None

    def close(self) -> None:
        try:
            super().close()
        finally:
            if self._runtime_lease is not None:
                self._runtime_lease.__exit__(None, None, None)
                self._runtime_lease = None


def now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def connect() -> sqlite3.Connection:
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    lease = runtime_guard()
    lease.__enter__()
    connection = None
    try:
        connection = sqlite3.connect(
            settings.database_path, timeout=10, check_same_thread=False, factory=_GuardedConnection
        )
        connection._runtime_lease = lease
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection
    except BaseException:
        if connection is not None:
            connection.close()
        else:
            lease.__exit__(None, None, None)
        raise


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
    with transaction() as connection:
        return _apply_migrations(connection)


def _execute_migration(connection: sqlite3.Connection, script: str) -> None:
    # executescript implicitly commits an open transaction. Execute complete SQL
    # statements instead, preserving triggers and semicolons inside strings.
    def authorize(action, _arg1, _arg2, _database, _trigger):
        return (
            sqlite3.SQLITE_DENY
            if action
            in {
                sqlite3.SQLITE_TRANSACTION,
                sqlite3.SQLITE_SAVEPOINT,
                sqlite3.SQLITE_ATTACH,
                sqlite3.SQLITE_DETACH,
            }
            else sqlite3.SQLITE_OK
        )

    connection.set_authorizer(authorize)
    try:
        statement = ""
        for char in script:
            statement += char
            if char == ";" and sqlite3.complete_statement(statement):
                connection.execute(statement)
                statement = ""
        if statement.strip():
            connection.execute(statement)
    finally:
        connection.set_authorizer(None)


def _apply_migrations(connection: sqlite3.Connection) -> list[str]:
    paths = sorted((ROOT / "backend" / "migrations").glob("*.sql"))
    if not paths:
        raise RuntimeError(
            "Required migration assets are missing; check the installed application root"
        )
    applied: list[str] = []
    connection.execute(MIGRATION_TABLE)
    known = {row[0] for row in connection.execute("SELECT name FROM schema_migrations")}
    for path in paths:
        if path.name in known:
            continue
        _execute_migration(connection, path.read_text(encoding="utf-8"))
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
    with closing(connect()) as source:
        return _snapshot(source, destination or settings.backup_path)


def _copy_database(source: sqlite3.Connection, output: sqlite3.Connection) -> None:
    def progress(status, _remaining, _total):
        # Python's backup otherwise retries a locked destination indefinitely.
        if status in {sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED}:
            raise sqlite3.OperationalError("Database is busy; stop all database writers and retry")

    source.backup(output, progress=progress, sleep=0)


def _snapshot(source: sqlite3.Connection, destination: Path) -> Path:
    folder = destination.resolve()
    folder.mkdir(parents=True, exist_ok=True)
    prefix = f"simbi-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-"
    descriptor, name = tempfile.mkstemp(prefix=prefix, suffix=".partial", dir=folder)
    os.close(descriptor)
    temporary = Path(name)
    target = temporary.with_suffix(".db")
    try:
        with closing(sqlite3.connect(temporary)) as output:
            _copy_database(source, output)
            _check_integrity(output)
            output.execute("PRAGMA journal_mode=DELETE")
        # A hard link publishes atomically without overwriting a prior backup,
        # even if a random suffix repeats. Unsupported filesystems fail closed.
        os.link(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def _check_integrity(connection: sqlite3.Connection) -> None:
    if [row[0] for row in connection.execute("PRAGMA integrity_check")] != ["ok"]:
        raise sqlite3.DatabaseError("Database integrity check failed")
    if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise sqlite3.DatabaseError("Database foreign-key check failed")


def _validate_schema(connection: sqlite3.Connection) -> None:
    _check_integrity(connection)
    paths = sorted((ROOT / "backend" / "migrations").glob("*.sql"))
    recorded = [
        row[0] for row in connection.execute("SELECT name FROM schema_migrations ORDER BY name")
    ]
    if not recorded or recorded != [path.name for path in paths[: len(recorded)]]:
        raise sqlite3.DatabaseError("Restore source has missing or unsupported migrations")

    def schema(database):
        return [
            (row[0], row[1], row[2], " ".join((row[3] or "").split()))
            for row in database.execute(
                "SELECT type,name,tbl_name,sql FROM sqlite_master "
                "WHERE substr(name,1,7) != 'sqlite_' ORDER BY type,name"
            )
        ]

    with closing(sqlite3.connect(":memory:")) as reference:
        reference.execute(MIGRATION_TABLE)
        for path in paths[: len(recorded)]:
            _execute_migration(reference, path.read_text(encoding="utf-8"))
        if schema(connection) != schema(reference):
            raise sqlite3.DatabaseError(
                "Restore source schema does not match its migration history"
            )


def restore_backup(source: Path) -> Path | None:
    """Restore offline using SQLite's atomic backup transaction, never raw WAL-file copying."""
    source = source.resolve()
    target = settings.database_path.resolve()
    if source == target or (target.exists() and source.samefile(target)):
        raise ValueError("Restore source must differ from the active database")
    with file_lock(Path(str(target) + ".runtime.lock")):
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".simbi-restore-", dir=target.parent) as directory:
            staged_path = Path(directory) / "candidate.db"
            with closing(sqlite3.connect(staged_path)) as staged:
                staged.execute("PRAGMA trusted_schema=OFF")
                with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as candidate:
                    _copy_database(candidate, staged)
                _validate_schema(staged)
                staged.execute("PRAGMA foreign_keys=ON")
                with staged:
                    staged.execute("BEGIN IMMEDIATE")
                    _apply_migrations(staged)
                _validate_schema(staged)
                if target.exists():
                    with closing(sqlite3.connect(target, timeout=0)) as current:
                        safety_backup = _snapshot(current, settings.backup_path)
                        # SQLite rolls back an incomplete backup and includes WAL state.
                        _copy_database(staged, current)
                    return safety_backup
                staged.execute("PRAGMA journal_mode=DELETE")
            os.replace(staged_path, target)
            return None
