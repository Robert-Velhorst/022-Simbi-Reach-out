from __future__ import annotations

import argparse
import signal
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .config import settings
from .db import audit, create_backup, fetch_one, file_lock, migrate, now, runtime_guard, transaction
from .hai import export_hai_feed


def _run_once() -> dict[str, int]:
    created = 0
    expired_sessions = 0
    expired_login_attempts = 0
    backups_created = 0
    backups_deleted = 0
    hai_feed_exports = 0
    cutoff = (datetime.now(UTC) - timedelta(days=7)).replace(microsecond=0).isoformat()
    login_cutoff = (datetime.now(UTC) - timedelta(days=1)).replace(microsecond=0).isoformat()
    with transaction() as connection:
        cursor = connection.execute("DELETE FROM sessions WHERE expires_at<=?", (now(),))
        expired_sessions = cursor.rowcount
        cursor = connection.execute(
            "DELETE FROM login_attempts WHERE updated_at<=? AND (locked_until IS NULL OR locked_until<=?)",
            (login_cutoff, now()),
        )
        expired_login_attempts = cursor.rowcount
        candidates = connection.execute(
            "SELECT d.id,d.workspace_id,p.name FROM drafts d JOIN prospects p ON p.id=d.prospect_id "
            "WHERE d.state='sent' AND d.sent_at<=? "
            "AND NOT EXISTS (SELECT 1 FROM replies r WHERE r.draft_id=d.id) "
            "AND NOT EXISTS (SELECT 1 FROM reminders m WHERE m.draft_id=d.id "
            "AND (m.status='open' OR m.created_by='worker'))",
            (cutoff,),
        ).fetchall()
        for draft in candidates:
            reminder_id = connection.execute(
                "INSERT INTO reminders(workspace_id,draft_id,title,due_at,created_by,created_at) "
                "VALUES (?,?,?,?,?,?)",
                (
                    draft["workspace_id"],
                    draft["id"],
                    f"Decide whether to follow up with {draft['name']}",
                    now(),
                    "worker",
                    now(),
                ),
            ).lastrowid
            audit(
                connection,
                draft["workspace_id"],
                None,
                "reminder.generated",
                "reminder",
                reminder_id,
                {"draft_id": draft["id"]},
            )
            created += 1
    if settings.auto_backup:
        today = datetime.now(UTC).date().isoformat()
        state = fetch_one("SELECT value FROM maintenance_state WHERE name='last_backup_date'")
        if not state or state["value"] != today:
            create_backup(settings.backup_path)
            backups_created = 1
            with transaction() as connection:
                connection.execute(
                    "INSERT INTO maintenance_state(name,value,updated_at) VALUES ('last_backup_date',?,?) "
                    "ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
                    (today, now()),
                )
            backup_cutoff = datetime.now(UTC) - timedelta(days=settings.backup_retention_days)
            backup_root = settings.backup_path.resolve()
            for candidate in backup_root.glob("simbi-*.db"):
                resolved = candidate.resolve()
                modified = datetime.fromtimestamp(candidate.stat().st_mtime, UTC)
                if resolved.parent == backup_root and modified < backup_cutoff:
                    candidate.unlink()
                    backups_deleted += 1
    # First-time setup has no workspace yet. Do not fabricate a feed or block bootstrap.
    if settings.hai_feed_path and fetch_one("SELECT id FROM workspaces LIMIT 1"):
        _, _, changed = export_hai_feed(
            settings.hai_feed_path, include_content=settings.hai_include_content
        )
        hai_feed_exports = int(changed)
    return {
        "reminders_created": created,
        "sessions_expired": expired_sessions,
        "login_attempts_expired": expired_login_attempts,
        "backups_created": backups_created,
        "backups_deleted": backups_deleted,
        "hai_feed_exports": hai_feed_exports,
    }


def _record_state(name: str, value: str) -> None:
    with transaction() as connection:
        connection.execute(
            "INSERT INTO maintenance_state(name,value,updated_at) VALUES (?,?,?) "
            "ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            (name, value, datetime.now(UTC).isoformat()),
        )


def run_once() -> dict[str, int]:
    try:
        result = _run_once()
    except Exception:
        # Health stores only timestamps, never exception text or private feed paths.
        _record_state("last_maintenance_error", datetime.now(UTC).isoformat())
        raise
    _record_state("last_maintenance_success", datetime.now(UTC).isoformat())
    return result


def worker_lock():
    return file_lock(Path(str(settings.database_path.resolve()) + ".worker.lock"))


def healthcheck() -> bool:
    try:
        with worker_lock():
            return False  # An old success cannot stand in for a running worker.
    except RuntimeError:
        pass
    try:
        success = fetch_one(
            "SELECT value FROM maintenance_state WHERE name='last_maintenance_success'"
        )
        error = fetch_one("SELECT value FROM maintenance_state WHERE name='last_maintenance_error'")
        interval = fetch_one(
            "SELECT value FROM maintenance_state WHERE name='last_maintenance_interval'"
        )
        if not success or not interval:
            return False
        timestamp = datetime.fromisoformat(success["value"])
        age = (datetime.now(UTC) - timestamp).total_seconds()
        return 0 <= age <= int(interval["value"]) + 60 and (
            not error or datetime.fromisoformat(error["value"]) < timestamp
        )
    except (ValueError, TypeError, OSError):
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Run local reminder maintenance")
    parser.add_argument("--once", action="store_true", help="Run one maintenance cycle and exit")
    parser.add_argument("--interval", type=int, default=300, help="Loop interval in seconds")
    parser.add_argument(
        "--healthcheck",
        action="store_true",
        help="Check live worker and recent successful maintenance",
    )
    args = parser.parse_args()
    if args.interval < 30:
        parser.error("--interval must be at least 30 seconds")
    if args.healthcheck:
        raise SystemExit(0 if healthcheck() else 1)
    with runtime_guard(), worker_lock():
        migrate()
        _record_state("last_maintenance_interval", str(args.interval))
        if args.once:
            print(run_once())
            return
        _run_loop(args.interval)


def _run_loop(interval: int) -> None:
    running = True

    def stop(*_: object) -> None:
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    while running:
        print(run_once(), flush=True)
        for _ in range(interval):
            if not running:
                break
            time.sleep(1)


if __name__ == "__main__":
    main()
