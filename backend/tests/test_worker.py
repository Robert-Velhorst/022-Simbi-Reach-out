from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta

from app.db import create_backup, transaction
from app.worker import run_once
from conftest import csrf_headers, draft_hash, setup_owner
from test_critical_path import APPROVAL_CHECKS, create_foundation


def test_worker_creates_one_followup_reminder(client):
    setup_owner(client)
    campaign_id, prospect_id, template_id = create_foundation(client)
    headers = csrf_headers(client)
    draft_id = client.post(
        "/api/drafts",
        headers=headers,
        json={
            "campaign_id": campaign_id,
            "prospect_id": prospect_id,
            "template_id": template_id,
        },
    ).json()["id"]
    client.post(
        f"/api/drafts/{draft_id}/review",
        headers=headers,
        json={
            "decision": "approve",
            "acknowledged_checks": APPROVAL_CHECKS,
            "expected_content_hash": draft_hash(draft_id),
        },
    )
    handoff = client.post(
        f"/api/drafts/{draft_id}/handoff",
        headers=csrf_headers(client, **{"Idempotency-Key": "worker-handoff-key-001"}),
        json={},
    ).json()
    client.post(
        f"/api/handoffs/{handoff['id']}/outcome",
        headers=headers,
        json={"outcome": "sent"},
    )
    old = (datetime.now(UTC) - timedelta(days=8)).replace(microsecond=0).isoformat()
    with transaction() as connection:
        connection.execute("UPDATE drafts SET sent_at=? WHERE id=?", (old, draft_id))
    assert run_once()["reminders_created"] == 1
    assert run_once()["reminders_created"] == 0
    reminders = client.get("/api/reminders").json()["items"]
    assert len(reminders) == 1
    assert reminders[0]["created_by"] == "worker"
    with transaction() as connection:
        connection.execute("UPDATE reminders SET status='done' WHERE id=?", (reminders[0]["id"],))
    assert run_once()["reminders_created"] == 0


def test_consistent_backup_passes_integrity_check(client, tmp_path):
    setup_owner(client)
    target = create_backup(tmp_path)
    assert target.parent == tmp_path
    with sqlite3.connect(target) as backup:
        assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert backup.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
