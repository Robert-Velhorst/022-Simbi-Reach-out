from __future__ import annotations

import argparse
import signal
import time
from datetime import UTC, datetime, timedelta

from .config import settings
from .db import audit, create_backup, fetch_one, migrate, now, transaction
from .hai import export_hai_feed


def run_once() -> dict[str, int]:
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
            "AND NOT EXISTS (SELECT 1 FROM reminders m WHERE m.draft_id=d.id AND m.status='open')",
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
    if settings.hai_feed_path:
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Run local reminder maintenance")
    parser.add_argument("--once", action="store_true", help="Run one maintenance cycle and exit")
    parser.add_argument("--interval", type=int, default=300, help="Loop interval in seconds")
    args = parser.parse_args()
    if args.interval < 30:
        parser.error("--interval must be at least 30 seconds")
    migrate()
    if args.once:
        print(run_once())
        return
    running = True

    def stop(*_: object) -> None:
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    while running:
        print(run_once(), flush=True)
        for _ in range(args.interval):
            if not running:
                break
            time.sleep(1)


if __name__ == "__main__":
    main()
