from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.db import transaction
from app.worker import run_once
from conftest import csrf_headers, setup_owner
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
        json={"decision": "approve", "acknowledged_checks": APPROVAL_CHECKS},
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
