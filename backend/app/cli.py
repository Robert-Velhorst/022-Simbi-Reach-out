from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .config import ROOT, settings
from .db import create_backup, database_size, fetch_all, fetch_one, migrate, now, transaction
from .hai import export_hai_feed


def doctor() -> int:
    checks: list[tuple[str, bool, str]] = []
    try:
        applied = migrate()
        checks.append(("database", True, f"reachable; {len(applied)} migration(s) applied"))
    except sqlite3.Error as exc:
        checks.append(("database", False, str(exc)))
    checks.append(
        (
            "environment",
            settings.environment in {"local", "test", "demo", "production"},
            settings.environment,
        )
    )
    checks.append(
        ("frontend", (ROOT / "frontend" / "package.json").exists(), "package manifest present")
    )
    checks.append(
        (
            "production_cookie",
            settings.environment != "production" or settings.cookie_secure,
            str(settings.cookie_secure),
        )
    )
    checks.append(
        (
            "unsafe_automation",
            not any(ROOT.glob("*automation*.py")),
            "legacy browser automation absent",
        )
    )
    for name, passed, detail in checks:
        print(f"{'PASS' if passed else 'FAIL'} {name}: {detail}")
    return 0 if all(item[1] for item in checks) else 1


def backup(destination: str | None = None) -> Path:
    folder = Path(destination).resolve() if destination else None
    target = create_backup(folder)
    print(f"Backup created: {target} ({target.stat().st_size} bytes)")
    return target


def restore(source_value: str, confirm: bool) -> int:
    if not confirm:
        print("Restore is destructive. Re-run with --confirm after checking the source path.")
        return 2
    source = Path(source_value).resolve()
    if not source.is_file() or source.suffix.lower() != ".db":
        print("Restore source must be an existing .db file")
        return 2
    with sqlite3.connect(source) as candidate:
        integrity = candidate.execute("PRAGMA integrity_check").fetchone()[0]
        required = candidate.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
        ).fetchone()[0]
    if integrity != "ok" or not required:
        print("Restore source failed integrity or schema checks")
        return 2
    backup()
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, settings.database_path)
    migrate()
    print(f"Restored: {settings.database_path}")
    return 0


def reconcile(repair: bool) -> int:
    migrate()
    findings = {
        "orphan_drafts": fetch_one(
            "SELECT COUNT(*) AS count FROM drafts d LEFT JOIN prospects p ON p.id=d.prospect_id "
            "LEFT JOIN campaigns c ON c.id=d.campaign_id WHERE p.id IS NULL OR c.id IS NULL"
        )["count"],
        "sent_without_timestamp": fetch_one(
            "SELECT COUNT(*) AS count FROM drafts WHERE state='sent' AND sent_at IS NULL"
        )["count"],
        "expired_sessions": fetch_one(
            "SELECT COUNT(*) AS count FROM sessions WHERE expires_at<=?", (now(),)
        )["count"],
    }
    repaired = 0
    if repair:
        with transaction() as connection:
            repaired += connection.execute(
                "DELETE FROM sessions WHERE expires_at<=?", (now(),)
            ).rowcount
            repaired += connection.execute(
                "UPDATE drafts SET state='ambiguous',updated_at=? WHERE state='sent' AND sent_at IS NULL",
                (now(),),
            ).rowcount
    print(json.dumps({"findings": findings, "repaired": repaired}, indent=2))
    return 0 if not findings["orphan_drafts"] else 1


def purge_retention(confirm: bool) -> int:
    if not confirm:
        print("Retention purge deletes expired operational events. Re-run with --confirm.")
        return 2
    cutoff = (
        (datetime.now(UTC) - timedelta(days=settings.retention_days))
        .replace(microsecond=0)
        .isoformat()
    )
    with transaction() as connection:
        analytics = connection.execute(
            "DELETE FROM analytics_events WHERE created_at<?", (cutoff,)
        ).rowcount
        sessions = connection.execute("DELETE FROM sessions WHERE expires_at<=?", (now(),)).rowcount
    print(
        json.dumps({"analytics_deleted": analytics, "sessions_deleted": sessions, "cutoff": cutoff})
    )
    return 0


def support_bundle() -> Path:
    migrate()
    output = settings.database_path.parent / "support-bundles"
    output.mkdir(parents=True, exist_ok=True)
    target = output / f"support-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.json"
    payload = {
        "generated_at": now(),
        "environment": settings.environment,
        "database_bytes": database_size(),
        "migrations": fetch_all("SELECT * FROM schema_migrations ORDER BY name"),
        "latest_event_types": fetch_all(
            "SELECT event_type,created_at FROM audit_events ORDER BY created_at DESC LIMIT 50"
        ),
        "redaction": "No PII, credentials, message bodies, tokens, or provider handles are included.",
    }
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Sanitized support bundle created: {target}")
    return target


def main() -> None:
    parser = argparse.ArgumentParser(prog="simbi", description="Simbi Reach-Out operator CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("doctor")
    subparsers.add_parser("migrate")
    backup_parser = subparsers.add_parser("backup")
    backup_parser.add_argument("--destination")
    restore_parser = subparsers.add_parser("restore")
    restore_parser.add_argument("source")
    restore_parser.add_argument("--confirm", action="store_true")
    reconcile_parser = subparsers.add_parser("reconcile")
    reconcile_parser.add_argument("--repair", action="store_true")
    purge_parser = subparsers.add_parser("purge-retention")
    purge_parser.add_argument("--confirm", action="store_true")
    subparsers.add_parser("support-bundle")
    hai_parser = subparsers.add_parser(
        "hai-export", help="Write a privacy-scoped generic JSON feed for HAI"
    )
    hai_parser.add_argument("destination")
    hai_parser.add_argument("--workspace-id", type=int)
    hai_parser.add_argument(
        "--include-content",
        action="store_true",
        help="Explicitly include prospect names and draft text in the HAI feed",
    )
    args = parser.parse_args()
    if args.command == "doctor":
        raise SystemExit(doctor())
    if args.command == "migrate":
        print({"applied": migrate()})
    elif args.command == "backup":
        backup(args.destination)
    elif args.command == "restore":
        raise SystemExit(restore(args.source, args.confirm))
    elif args.command == "reconcile":
        raise SystemExit(reconcile(args.repair))
    elif args.command == "purge-retention":
        raise SystemExit(purge_retention(args.confirm))
    elif args.command == "support-bundle":
        support_bundle()
    elif args.command == "hai-export":
        target, count, changed = export_hai_feed(
            Path(args.destination), args.workspace_id, args.include_content
        )
        print(
            json.dumps(
                {
                    "destination": str(target),
                    "items": count,
                    "updated": changed,
                    "content_included": args.include_content,
                    "automatic_sending_allowed": False,
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
