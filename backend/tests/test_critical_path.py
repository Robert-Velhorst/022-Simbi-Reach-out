from __future__ import annotations

from conftest import csrf_headers, draft_hash, setup_owner
from fastapi.testclient import TestClient

APPROVAL_CHECKS = [
    "source_authorized",
    "message_personalized",
    "policy_reviewed",
    "manual_send_understood",
]


def create_foundation(client: TestClient) -> tuple[int, int, int]:
    headers = csrf_headers(client)
    compliance = client.post(
        "/api/settings/compliance",
        headers=headers,
        json={
            "reviewed_simbi_terms": True,
            "confirmed_no_scraping": True,
            "confirmed_manual_send": True,
            "confirmed_suppression_process": True,
        },
    )
    assert compliance.status_code == 200, compliance.text
    campaign = client.post(
        "/api/campaigns",
        headers=headers,
        json={
            "name": "Community help",
            "description": "Respond to reviewed member requests",
            "purpose": "Offer a relevant introduction after a member asks for help",
            "lawful_basis": "Contextual response to a manually reviewed public request",
            "daily_limit": 3,
            "cooldown_minutes": 1440,
        },
    )
    assert campaign.status_code == 201, campaign.text
    campaign_id = campaign.json()["id"]
    activated = client.patch(
        f"/api/campaigns/{campaign_id}/status",
        headers=headers,
        json={"status": "active"},
    )
    assert activated.status_code == 200
    prospect = client.post(
        "/api/prospects",
        headers=headers,
        json={
            "name": "Alex Morgan",
            "organization": "Community Lab",
            "provider": "simbi",
            "source_url": "https://simbi.com/alex-morgan-request",
            "notes": "Asked for a community introduction",
            "consent_status": "contextual",
        },
    )
    assert prospect.status_code == 201, prospect.text
    template = client.post(
        "/api/templates",
        headers=headers,
        json={
            "name": "Relevant introduction",
            "provider": "simbi",
            "subject": "A possible introduction",
            "body": (
                "Hello {name}, I saw your request and may be able to help with {campaign}. "
                "Your note mentioned: {notes}. If this is not useful, no thanks is completely "
                "fine and I will not follow up."
            ),
        },
    )
    assert template.status_code == 201, template.text
    return campaign_id, prospect.json()["id"], template.json()["id"]


def test_complete_assisted_critical_path(client: TestClient):
    setup_owner(client)
    campaign_id, prospect_id, template_id = create_foundation(client)
    headers = csrf_headers(client)
    draft = client.post(
        "/api/drafts",
        headers=headers,
        json={
            "campaign_id": campaign_id,
            "prospect_id": prospect_id,
            "template_id": template_id,
        },
    )
    assert draft.status_code == 201, draft.text
    draft_id = draft.json()["id"]
    assert draft.json()["state"] == "needs_review"
    missing = client.post(
        f"/api/drafts/{draft_id}/review",
        headers=headers,
        json={"decision": "approve", "acknowledged_checks": []},
    )
    assert missing.status_code == 422
    approved = client.post(
        f"/api/drafts/{draft_id}/review",
        headers=headers,
        json={
            "decision": "approve",
            "acknowledged_checks": APPROVAL_CHECKS,
            "expected_content_hash": draft_hash(draft_id),
        },
    )
    assert approved.status_code == 200
    no_key = client.post(f"/api/drafts/{draft_id}/handoff", headers=headers, json={})
    assert no_key.status_code == 400
    idempotency = "critical-path-handoff-0001"
    handoff_headers = csrf_headers(client, **{"Idempotency-Key": idempotency})
    prepared = client.post(f"/api/drafts/{draft_id}/handoff", headers=handoff_headers, json={})
    assert prepared.status_code == 200, prepared.text
    assert prepared.json()["instruction"].startswith("Copy the message")
    assert prepared.json()["provider_url"].startswith("https://simbi.com/")
    replay = client.post(f"/api/drafts/{draft_id}/handoff", headers=handoff_headers, json={})
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    handoff_id = prepared.json()["id"]
    sent = client.post(
        f"/api/handoffs/{handoff_id}/outcome",
        headers=headers,
        json={"outcome": "sent"},
    )
    assert sent.json()["draft_state"] == "sent"
    reply = client.post(
        "/api/replies",
        headers=headers,
        json={"draft_id": draft_id, "body": "Thanks, I would like that introduction."},
    )
    assert reply.status_code == 201
    assert reply.json()["state"] == "replied"
    report = client.get("/api/reports/summary")
    assert report.status_code == 200
    assert report.json()["funnel"]["replied"] == 1
    audit = client.get("/api/audit")
    event_types = {item["event_type"] for item in audit.json()["items"]}
    assert {
        "compliance.acknowledged",
        "draft.approved",
        "handoff.prepared",
        "handoff.sent",
        "reply.recorded",
    }.issubset(event_types)


def test_suppression_blocks_drafts_and_is_exported(client: TestClient):
    setup_owner(client)
    campaign_id, prospect_id, template_id = create_foundation(client)
    headers = csrf_headers(client)
    suppressed = client.post(
        "/api/suppressions",
        headers=headers,
        json={"prospect_id": prospect_id, "reason": "Asked not to be contacted"},
    )
    assert suppressed.status_code == 201
    draft = client.post(
        "/api/drafts",
        headers=headers,
        json={
            "campaign_id": campaign_id,
            "prospect_id": prospect_id,
            "template_id": template_id,
        },
    )
    assert draft.status_code == 409
    assert draft.json()["error"]["code"] == "prospect_suppressed"
    exported = client.get("/api/export")
    assert exported.status_code == 200
    assert len(exported.json()["suppressions"]) == 1


def test_csv_preview_is_atomic(client: TestClient):
    setup_owner(client)
    headers = csrf_headers(client)
    csv_text = (
        "name,source_url,organization,consent_status\n"
        "Asha,https://simbi.com/asha,Collective,contextual\n"
        "Broken,not-a-url,Collective,unknown\n"
    )
    preview = client.post(
        "/api/prospects/import", headers=headers, json={"csv_text": csv_text, "commit": False}
    )
    assert preview.status_code == 200
    assert preview.json()["valid"] == 1
    assert len(preview.json()["errors"]) == 1
    commit = client.post(
        "/api/prospects/import", headers=headers, json={"csv_text": csv_text, "commit": True}
    )
    assert commit.status_code == 422
    assert client.get("/api/prospects").json()["total"] == 0
