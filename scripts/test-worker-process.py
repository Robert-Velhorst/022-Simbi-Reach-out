"""Isolated executable worker contract tests; no shared backend test database."""
# ruff: noqa: S603 -- subprocess arguments use this interpreter and fixed local module names only.

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch


class WorkerProcessTests(unittest.TestCase):
    def test_hai_opt_in_allows_empty_database_bootstrap(self):
        with tempfile.TemporaryDirectory(prefix="simbi-worker-hai-test-") as folder:
            feed = Path(folder) / "feed.json"
            env = dict(
                os.environ,
                SIMBI_ENV="test",
                SIMBI_DATABASE_PATH=str(Path(folder) / "test.db"),
                SIMBI_FRONTEND_ORIGIN="http://localhost:8000",
                SIMBI_COOKIE_SECURE="false",
                SIMBI_AUTO_BACKUP="false",
                SIMBI_HAI_FEED_PATH=str(feed),
            )
            result = subprocess.run(
                [sys.executable, "-m", "app.worker", "--once"],
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(
                result.returncode, 0, "HAI must wait for initial workspace setup: " + result.stderr
            )
            self.assertFalse(feed.exists(), "No feed should impersonate a workspace before setup")

    def test_standalone_maintenance_failure_stops_readiness(self):
        import uvicorn
        from app.windows import _maintenance

        stop = threading.Event()
        failed = threading.Event()
        server = uvicorn.Server(uvicorn.Config(lambda: None))
        with patch("app.worker.run_once", side_effect=RuntimeError("fixture failure")):
            thread = threading.Thread(target=_maintenance, args=(stop, failed, server), daemon=True)
            thread.start()
            thread.join(timeout=2)
            stop.set()
            self.assertTrue(failed.is_set(), "Standalone maintenance failure must stop the server")
            self.assertTrue(server.should_exit, "The real server shutdown flag must be set")

    def test_health_requires_success_and_a_live_singleton_worker(self):
        with tempfile.TemporaryDirectory(prefix="simbi-worker-test-") as folder:
            database = Path(folder) / "test.db"
            env = dict(
                os.environ,
                SIMBI_ENV="test",
                SIMBI_DATABASE_PATH=str(database),
                SIMBI_FRONTEND_ORIGIN="http://localhost:8000",
                SIMBI_COOKIE_SECURE="false",
                SIMBI_AUTO_BACKUP="false",
                SIMBI_HAI_FEED_PATH="",
            )
            args = [sys.executable, "-m", "app.worker"]
            completed = subprocess.run([*args, "--once"], env=env, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            with closing(sqlite3.connect(database)) as db:
                success = db.execute(
                    "SELECT value FROM maintenance_state WHERE name='last_maintenance_success'"
                ).fetchone()
            self.assertIsNotNone(
                success, "Successful maintenance must persist its health timestamp"
            )
            self.assertNotEqual(
                subprocess.run([*args, "--healthcheck"], env=env, capture_output=True).returncode, 0
            )
            worker = subprocess.Popen(
                [*args, "--interval", "30"], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )
            try:
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    healthy = subprocess.run([*args, "--healthcheck"], env=env, capture_output=True)
                    if healthy.returncode == 0:
                        break
                    time.sleep(0.1)
                self.assertEqual(healthy.returncode, 0, healthy.stderr)
                duplicate = subprocess.run(
                    [*args, "--once"], env=env, capture_output=True, timeout=10
                )
                self.assertNotEqual(
                    duplicate.returncode, 0, "A second worker must not enter maintenance"
                )
                with closing(sqlite3.connect(database)) as db:
                    db.execute(
                        "UPDATE maintenance_state SET value='2099-01-01T00:00:00+00:00' WHERE name='last_maintenance_error'"
                    )
                    db.execute(
                        "INSERT OR REPLACE INTO maintenance_state VALUES ('last_maintenance_error','2099-01-01T00:00:00+00:00','2099-01-01T00:00:00+00:00')"
                    )
                    db.commit()
                self.assertNotEqual(
                    subprocess.run(
                        [*args, "--healthcheck"], env=env, capture_output=True
                    ).returncode,
                    0,
                )
            finally:
                worker.terminate()
                worker.communicate(timeout=10)
            self.assertNotEqual(
                subprocess.run([*args, "--healthcheck"], env=env, capture_output=True).returncode, 0
            )


if __name__ == "__main__":
    unittest.main()
