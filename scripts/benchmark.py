from __future__ import annotations

import json
import os
import shutil
import time
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
    load_seconds = time.perf_counter() - started
    query_started = time.perf_counter()
    with connect() as connection:
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
    database_bytes = (RUNTIME / "benchmark.db").stat().st_size
    result = {
        "rows": ROWS,
        "load_seconds": round(load_seconds, 3),
        "query_seconds": round(query_seconds, 4),
        "database_bytes": database_bytes,
        "summary_total": summary["total"],
        "page_rows": len(page),
    }
    print(json.dumps(result, indent=2))
    if summary["total"] != ROWS or len(page) != 100:
        raise SystemExit("Benchmark data integrity failed")
    if query_seconds > 2 or database_bytes > 30_000_000:
        raise SystemExit("Benchmark exceeded the documented resource budget")


if __name__ == "__main__":
    main()
