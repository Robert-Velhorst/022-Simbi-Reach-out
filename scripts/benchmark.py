from __future__ import annotations

import json
import os
import shutil
import time
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / ".benchmark-runtime"
if RUNTIME.parent != ROOT or RUNTIME.name != ".benchmark-runtime":
    raise RuntimeError("Unsafe benchmark runtime path")
shutil.rmtree(RUNTIME, ignore_errors=True)
RUNTIME.mkdir()
os.environ["SIMBI_ENV"] = "test"
os.environ["SIMBI_DATABASE_PATH"] = str(RUNTIME / "benchmark.db")
os.environ["SIMBI_FRONTEND_ORIGIN"] = "http://testserver"
os.environ["SIMBI_COOKIE_SECURE"] = "false"

from app.db import connect, migrate, now, transaction  # noqa: E402

ROWS = 10_000


def main() -> None:
    migrate()
    timestamp = now()
    started = time.perf_counter()
    with transaction() as connection:
        user_id = connection.execute(
            "INSERT INTO users(email,password_hash,display_name,created_at) VALUES (?,?,?,?)",
            ("benchmark@example.test", "not-used", "Benchmark", timestamp),
        ).lastrowid
        workspace_id = connection.execute(
            "INSERT INTO workspaces(name,created_at) VALUES (?,?)", ("Benchmark", timestamp)
        ).lastrowid
        connection.execute(
            "INSERT INTO memberships(user_id,workspace_id,role) VALUES (?,?,'owner')",
            (user_id, workspace_id),
        )
        campaign_id = connection.execute(
            "INSERT INTO campaigns(workspace_id,name,purpose,lawful_basis,status,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (workspace_id, "Scale", "Benchmark only", "Local test", "active", timestamp, timestamp),
        ).lastrowid
        prospects = [
            (
                workspace_id,
                f"Prospect {index}",
                "Benchmark",
                f"https://example.test/{index}",
                timestamp,
                timestamp,
            )
            for index in range(ROWS)
        ]
        connection.executemany(
            "INSERT INTO prospects(workspace_id,name,organization,source_url,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?)",
            prospects,
        )
        ids = connection.execute(
            "SELECT id FROM prospects WHERE workspace_id=? ORDER BY id", (workspace_id,)
        ).fetchall()
        connection.executemany(
            "INSERT INTO drafts(workspace_id,campaign_id,prospect_id,body,state,quality_score,created_at,updated_at) "
            "VALUES (?,?,?,'Benchmark message','needs_review',90,?,?)",
            [(workspace_id, campaign_id, row["id"], timestamp, timestamp) for row in ids],
        )
        draft_id = connection.execute("SELECT id FROM drafts ORDER BY id LIMIT 1").fetchone()["id"]
        instants = [
            (datetime(2026, 10, 1, 22, 0, 0, index, tzinfo=UTC) + timedelta(hours=2)).isoformat().replace("+00:00", "+02:00")
            if index % 2 else datetime(2026, 10, 1, 22, 0, 0, index, tzinfo=UTC).isoformat().replace("+00:00", "Z")
            for index in range(ROWS)
        ]
        connection.executemany(
            "INSERT INTO replies(workspace_id,draft_id,body,received_at,created_by,created_at) VALUES (?,?,?,?,?,?)",
            [(workspace_id, draft_id, "Fictional benchmark reply", instant, user_id, timestamp) for instant in instants],
        )
        connection.executemany(
            "INSERT INTO reminders(workspace_id,draft_id,title,due_at,created_by,created_at) VALUES (?,?,?,?,'user',?)",
            [(workspace_id, draft_id, "Fictional benchmark reminder", instant, timestamp) for instant in instants],
        )
    load_seconds = time.perf_counter() - started
    query_started = time.perf_counter()
    with closing(connect()) as connection:
        summary = connection.execute(
            "SELECT COUNT(*) AS total,SUM(state='needs_review') AS needs_review,AVG(quality_score) AS quality "
            "FROM drafts WHERE workspace_id=?",
            (workspace_id,),
        ).fetchone()
        page = connection.execute(
            "SELECT id,state,quality_score FROM drafts WHERE workspace_id=? "
            "ORDER BY updated_at DESC LIMIT 100",
            (workspace_id,),
        ).fetchall()
    query_seconds = time.perf_counter() - query_started
    conversation_pages = {}
    conversation_seconds = {}
    # Match the joined, workspace-filtered API list queries, including true time
    # ordering and stable IDs. This remains a database fixture, not an HTTP load test.
    with closing(connect()) as connection:
        for table, field, direction in [("replies", "received_at", "DESC"), ("reminders", "due_at", "ASC")]:
            started = time.perf_counter()
            if table == "replies":
                query = (
                    "SELECT r.*,p.name AS prospect_name,c.name AS campaign_name FROM replies r "
                    "JOIN drafts d ON d.id=r.draft_id JOIN prospects p ON p.id=d.prospect_id "
                    "JOIN campaigns c ON c.id=d.campaign_id WHERE r.workspace_id=? "
                )
            else:
                query = (
                    "SELECT r.*,p.name AS prospect_name,c.name AS campaign_name FROM reminders r "
                    "LEFT JOIN drafts d ON d.id=r.draft_id LEFT JOIN prospects p ON p.id=COALESCE(r.prospect_id,d.prospect_id) "
                    "LEFT JOIN campaigns c ON c.id=d.campaign_id WHERE r.workspace_id=? AND r.status='open' "
                )
            rows = connection.execute(
                query + f"ORDER BY simbi_timestamp_key(r.{field}) IS NULL,simbi_timestamp_key(r.{field}) {direction},r.id {direction} LIMIT 100 OFFSET 50",
                (workspace_id,),
            ).fetchall()
            conversation_seconds[table] = time.perf_counter() - started
            conversation_pages[table] = [row["id"] for row in rows]
        started = time.perf_counter()
        due_count = connection.execute(
            "SELECT COUNT(*) AS n FROM reminders WHERE workspace_id=? AND status='open' AND simbi_timestamp_key(due_at)<=?",
            (workspace_id, "2026-10-02T00:00:00.000000+00:00"),
        ).fetchone()["n"]
        overview_page = connection.execute(
            "SELECT r.*,p.name AS prospect_name,c.name AS campaign_name FROM reminders r "
            "LEFT JOIN drafts d ON d.id=r.draft_id LEFT JOIN prospects p ON p.id=COALESCE(r.prospect_id,d.prospect_id) "
            "LEFT JOIN campaigns c ON c.id=d.campaign_id WHERE r.workspace_id=? AND r.status='open' "
            "ORDER BY simbi_timestamp_key(r.due_at) IS NULL,simbi_timestamp_key(r.due_at),r.id LIMIT 5",
            (workspace_id,),
        ).fetchall()
        conversation_seconds["overview_reminders"] = time.perf_counter() - started
    database_bytes = (RUNTIME / "benchmark.db").stat().st_size
    result = {
        "rows": ROWS,
        "load_seconds": round(load_seconds, 3),
        "query_seconds": round(query_seconds, 4),
        "database_bytes": database_bytes,
        "summary_total": summary["total"],
        "page_rows": len(page),
        "conversation_rows_each": ROWS,
        "conversation_page_offset": 50,
        "conversation_query_seconds": {table: round(seconds, 4) for table, seconds in conversation_seconds.items()},
    }
    print(json.dumps(result, indent=2))
    if summary["total"] != ROWS or len(page) != 100:
        raise SystemExit("Benchmark data integrity failed")
    if conversation_pages != {"replies": list(range(ROWS - 50, ROWS - 150, -1)), "reminders": list(range(51, 151))}:
        raise SystemExit("Conversation benchmark microsecond ordering failed")
    if due_count != ROWS or [row["id"] for row in overview_page] != list(range(1, 6)):
        raise SystemExit("Overview reminder benchmark failed")
    if max(query_seconds, *conversation_seconds.values()) > 2 or database_bytes > 30_000_000:
        raise SystemExit("Benchmark exceeded the documented resource budget")


if __name__ == "__main__":
    main()
