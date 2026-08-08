from __future__ import annotations

import argparse
import signal
import time
from datetime import UTC, datetime, timedelta

from .db import audit, migrate, now, transaction


def run_once() -> dict[str, int]:
    created = 0
    expired_sessions = 0
    cutoff = (datetime.now(UTC) - timedelta(days=7)).replace(microsecond=0).isoformat()
    with transaction() as connection:
        cursor = connection.execute("DELETE FROM sessions WHERE expires_at<=?", (now(),))
        expired_sessions = cursor.rowcount
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
    return {"reminders_created": created, "sessions_expired": expired_sessions}


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
