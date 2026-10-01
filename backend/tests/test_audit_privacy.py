from __future__ import annotations

import json
import sqlite3
from contextlib import closing

import pytest
from app import db
from app.domain import APPROVAL_CHECKS
from conftest import csrf_headers, draft_hash, remove_contact, setup_owner
from test_critical_path import create_foundation
from test_outreach_invariants import prepared_conversation


def details_for(client, event_type):
    events = client.get("/api/audit").json()["items"]
    event = next(item for item in events if item["event_type"] == event_type)
    assert event["workspace_id"] == event["actor_user_id"] == 1
    assert event["entity_id"] and event["created_at"]
    return json.loads(event["details"])


def test_stop_contact_does_not_duplicate_private_reason_in_audit(client):
    _, prospect, _, draft, handoff, headers = prepared_conversation(client)
    reason = "Fictional private reason about family circumstances"
    result = client.post(
        "/api/suppressions",
        headers=headers,
        json={"prospect_id": prospect, "reason": reason},
    )
    assert result.status_code == 201, result.text
    assert details_for(client, "prospect.suppressed") == {"restriction": "do_not_contact"}
    assert db.fetch_one("SELECT reason FROM suppressions")["reason"] == reason
    assert db.fetch_one("SELECT state FROM drafts WHERE id=?", (draft,))["state"] == "suppressed"
    assert (
        db.fetch_one("SELECT status FROM handoffs WHERE id=?", (handoff["id"],))["status"]
        == "cancelled"
    )
    assert client.post(f"/api/drafts/{draft}/handoff", headers=headers, json={}).status_code == 409

    # Actual cleanup must still retain the original restriction and its reason.
    assert remove_contact(client, prospect).status_code == 200
    exported = client.get("/api/export").json()
    assert exported["suppressions"][0]["reason"] == reason
    assert exported["suppressions"][0]["prospect_id"] is None
    assert reason not in json.dumps(exported["audit_events"])
    recreated = client.post(
        "/api/prospects",
        headers=csrf_headers(client),
        json={
            "name": "Recreated fictional contact",
            "source_url": "https://simbi.com/alex-morgan-request",
            "consent_status": "consented",
        },
    )
    assert recreated.status_code == 201
    assert recreated.json()["consent_status"] == "opted_out"


def test_provider_url_is_stored_as_setting_not_copied_into_audit(client):
    setup_owner(client)
    private_url = "https://simbi.com/fictional-private-path?context=private-query"
    result = client.post(
        "/api/settings/provider",
        headers=csrf_headers(client),
        json={"provider": "simbi", "base_url": private_url},
    )
    assert result.status_code == 200, result.text
    assert result.json()["base_url"] == private_url
    assert client.get("/api/settings").json()["providers"][0]["base_url"] == private_url
    assert details_for(client, "provider.updated") == {"mode": "assisted"}
    assert "private-query" not in json.dumps(client.get("/api/export").json()["audit_events"])


@pytest.mark.parametrize("decision", ["approve", "decline"])
def test_review_audit_keeps_only_canonical_checks(client, decision):
    setup_owner(client)
    campaign, prospect, template = create_foundation(client)
    headers = csrf_headers(client)
    draft = client.post(
        "/api/drafts",
        headers=headers,
        json={"campaign_id": campaign, "prospect_id": prospect, "template_id": template},
    ).json()["id"]
    acknowledged = sorted(APPROVAL_CHECKS) if decision == "approve" else ["source_authorized"]
    response = client.post(
        f"/api/drafts/{draft}/review",
        headers=headers,
        json={
            "decision": decision,
            "acknowledged_checks": [
                *acknowledged,
                *acknowledged,
                "Fictional private checklist text",
            ],
            "expected_content_hash": draft_hash(draft),
        },
    )
    assert response.status_code == 200, response.text
    event_type = "draft.approved" if decision == "approve" else "draft.declined"
    assert details_for(client, event_type) == {"checks": sorted(set(acknowledged))}
    assert "Fictional private checklist text" not in json.dumps(
        client.get("/api/export").json()["audit_events"]
    )


def test_unknown_checks_do_not_substitute_for_required_approval_checks(client):
    setup_owner(client)
    campaign, prospect, template = create_foundation(client)
    headers = csrf_headers(client)
    draft = client.post(
        "/api/drafts",
        headers=headers,
        json={"campaign_id": campaign, "prospect_id": prospect, "template_id": template},
    ).json()["id"]
    result = client.post(
        f"/api/drafts/{draft}/review",
        headers=headers,
        json={
            "decision": "approve",
            "acknowledged_checks": ["Fictional private text"],
            "expected_content_hash": draft_hash(draft),
        },
    )
    assert result.status_code == 422
    assert result.json()["error"]["code"] == "approval_checks_missing"
    assert db.fetch_one("SELECT state FROM drafts WHERE id=?", (draft,))["state"] == "needs_review"
    assert not db.fetch_one("SELECT id FROM audit_events WHERE event_type='draft.approved'")


@pytest.mark.parametrize(
    ("event_type", "submitted", "expected"),
    [
        (
            "prospect.suppressed",
            {"reason": "private", "notes": "private"},
            {"restriction": "do_not_contact"},
        ),
        ("provider.updated", {"base_url": "private", "mode": "private"}, {"mode": "assisted"}),
        (
            "draft.approved",
            {"checks": ["source_authorized", "private", "source_authorized"], "notes": "private"},
            {"checks": ["source_authorized"]},
        ),
        ("draft.declined", {"checks": ["private"]}, {"checks": []}),
        ("draft.declined", {"checks": None, "notes": "private"}, {"checks": []}),
        ("draft.approved", {"checks": {"source_authorized": "private"}}, {"checks": []}),
        ("draft.approved", {"checks": "source_authorized private"}, {"checks": []}),
    ],
)
def test_shared_audit_writer_enforces_policy_for_future_callers(
    client, event_type, submitted, expected
):
    setup_owner(client)
    with db.transaction() as connection:
        db.audit(connection, 1, 1, event_type, "fixture", 7, submitted)
    assert details_for(client, event_type) == expected
    # Sanitizing must not mutate the caller's original payload.
    assert "private" in json.dumps(submitted)


def test_new_policy_does_not_rewrite_legacy_history_or_other_evidence(client, tmp_path):
    setup_owner(client)
    legacy = {"reason": "Fictional historic reason"}
    evidence = {"draft_id": 7, "content_hash": "a" * 64}
    with db.transaction() as connection:
        legacy_id = connection.execute(
            "INSERT INTO audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,details,created_at) "
            "VALUES (1,1,'prospect.suppressed','prospect','7',?,?)",
            (json.dumps(legacy), "2020-01-01T00:00:00+00:00"),
        ).lastrowid
        db.audit(connection, 1, 1, "handoff.prepared", "handoff", 8, evidence)
    db.migrate()
    assert (
        json.loads(
            db.fetch_one("SELECT details FROM audit_events WHERE id=?", (legacy_id,))["details"]
        )
        == legacy
    )
    assert details_for(client, "handoff.prepared") == evidence
    exported = client.get("/api/export").json()
    assert any(json.loads(event["details"]) == legacy for event in exported["audit_events"])
    backup = db.create_backup(tmp_path / "private-backup")
    with closing(sqlite3.connect(backup)) as connection:
        assert (
            json.loads(
                connection.execute(
                    "SELECT details FROM audit_events WHERE id=?", (legacy_id,)
                ).fetchone()[0]
            )
            == legacy
        )
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
