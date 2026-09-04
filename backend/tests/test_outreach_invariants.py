from __future__ import annotations

import hashlib

import pytest
from app.db import fetch_one, transaction
from conftest import csrf_headers, draft_hash, setup_owner
from test_critical_path import APPROVAL_CHECKS, create_foundation


@pytest.mark.parametrize("revision", ["missing", "stale"])
def test_approval_requires_exact_reviewed_content(client, revision):
    setup_owner(client)
    campaign, prospect, template = create_foundation(client)
    headers = csrf_headers(client)
    draft_id = client.post(
        "/api/drafts",
        headers=headers,
        json={"campaign_id": campaign, "prospect_id": prospect, "template_id": template},
    ).json()["id"]
    original = fetch_one("SELECT * FROM drafts WHERE id=?", (draft_id,))
    original_hash = hashlib.sha256(
        (original["subject"] + "\n" + original["body"]).encode()
    ).hexdigest()
    assert (
        client.patch(
            f"/api/drafts/{draft_id}",
            headers=headers,
            json={"subject": "Changed by another editor", "body": original["body"]},
        ).status_code
        == 200
    )
    payload = {"decision": "approve", "acknowledged_checks": APPROVAL_CHECKS}
    if revision == "stale":
        payload["expected_content_hash"] = original_hash
    response = client.post(f"/api/drafts/{draft_id}/review", headers=headers, json=payload)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "draft_changed"
    assert fetch_one("SELECT state FROM drafts WHERE id=?", (draft_id,))["state"] == "needs_review"


@pytest.mark.parametrize("template", ["{name:1000000000}", "{name!r}", "{}"])
def test_template_only_accepts_plain_named_fields(client, template):
    setup_owner(client)
    response = client.post(
        "/api/templates",
        headers=csrf_headers(client),
        json={
            "name": "Unsafe formatting",
            "body": f"Hello {template}, can I help with your request?",
        },
    )
    assert response.status_code == 422


@pytest.mark.parametrize("url", ["https://simbi.com/\\other", "https://simbi.com/line\nbreak"])
def test_provider_url_rejects_ambiguous_browser_input(url):
    from app.security import validate_provider_url

    with pytest.raises(ValueError):
        validate_provider_url(url)


def prepared_conversation(client):
    setup_owner(client)
    campaign, prospect, template = create_foundation(client)
    headers = csrf_headers(client)
    draft = client.post(
        "/api/drafts",
        headers=headers,
        json={
            "campaign_id": campaign,
            "prospect_id": prospect,
            "template_id": template,
        },
    ).json()["id"]
    assert (
        client.post(
            f"/api/drafts/{draft}/review",
            headers=headers,
            json={
                "decision": "approve",
                "acknowledged_checks": APPROVAL_CHECKS,
                "expected_content_hash": draft_hash(draft),
            },
        ).status_code
        == 200
    )
    headers["Idempotency-Key"] = "invariant-handoff-key-0001"
    handoff = client.post(f"/api/drafts/{draft}/handoff", headers=headers, json={})
    assert handoff.status_code == 200
    return campaign, prospect, template, draft, handoff.json(), headers


@pytest.mark.parametrize("status", ["opted_out", "blocked"])
@pytest.mark.parametrize("intake", ["manual", "csv"])
def test_restriction_at_intake_survives_deletion(client, status, intake):
    setup_owner(client)
    headers = csrf_headers(client)
    payload = {
        "name": "Restricted Person",
        "source_url": "https://simbi.com/restricted-person",
        "consent_status": status,
    }
    if intake == "manual":
        assert client.post("/api/prospects", headers=headers, json=payload).status_code == 201
    else:
        assert (
            client.post(
                "/api/prospects/import",
                headers=headers,
                json={
                    "csv_text": f"name,source_url,consent_status\nRestricted Person,https://simbi.com/restricted-person,{status}\n",
                    "commit": True,
                },
            ).status_code
            == 200
        )
    prospect_id = client.get("/api/prospects").json()["items"][0]["id"]
    assert client.delete(f"/api/prospects/{prospect_id}", headers=headers).status_code == 200
    payload["consent_status"] = "consented"
    assert client.post("/api/prospects", headers=headers, json=payload).json()[
        "consent_status"
    ] in {"opted_out", "blocked"}


def test_replay_rechecks_approved_provider_host(client):
    _, _, _, draft, _, headers = prepared_conversation(client)
    with transaction() as connection:
        connection.execute("UPDATE provider_settings SET base_url='https://approved.example.test/'")
    response = client.post(f"/api/drafts/{draft}/handoff", headers=headers, json={})
    assert response.status_code == 409


def test_recovered_handoff_does_not_offer_send_after_pause(client):
    _, _, _, draft, _, headers = prepared_conversation(client)
    assert (
        client.post("/api/settings/pause", headers=headers, json={"paused": True}).status_code
        == 200
    )
    response = client.get(f"/api/handoffs?draft_id={draft}")
    assert response.status_code == 200
    assert response.json()["items"][0].get("can_open_provider") is False


@pytest.mark.parametrize("status", ["opted_out", "blocked"])
def test_legacy_intake_restriction_is_preserved_before_deletion(client, status):
    setup_owner(client)
    headers = csrf_headers(client)
    payload = {
        "name": "Legacy Person",
        "source_url": "https://simbi.com/legacy-person",
        "consent_status": "contextual",
    }
    prospect_id = client.post("/api/prospects", headers=headers, json=payload).json()["id"]
    with transaction() as connection:
        connection.execute(
            "UPDATE prospects SET consent_status=? WHERE id=?", (status, prospect_id)
        )
    assert client.delete(f"/api/prospects/{prospect_id}", headers=headers).status_code == 200
    payload["consent_status"] = "consented"
    assert (
        client.post("/api/prospects", headers=headers, json=payload).json()["consent_status"]
        == "opted_out"
    )


@pytest.mark.parametrize("intake", ["manual", "csv"])
def test_deleted_opt_out_remains_blocked_when_recreated(client, intake):
    _, prospect, _, _, _, headers = prepared_conversation(client)
    assert (
        client.post(
            "/api/suppressions",
            headers=headers,
            json={
                "prospect_id": prospect,
                "reason": "Do not contact me",
            },
        ).status_code
        == 201
    )
    assert client.delete(f"/api/prospects/{prospect}", headers=headers).status_code == 200
    if intake == "manual":
        response = client.post(
            "/api/prospects",
            headers=headers,
            json={
                "name": "Same Person",
                "provider": "simbi",
                "source_url": "https://SIMBI.com:443/alex-morgan-request#profile",
                "consent_status": "consented",
            },
        )
        assert response.status_code == 201
        assert response.json()["consent_status"] == "opted_out"
    else:
        response = client.post(
            "/api/prospects/import",
            headers=headers,
            json={
                "csv_text": "name,source_url,consent_status\nSame Person,https://simbi.com/alex-morgan-request,consented\n",
                "commit": True,
            },
        )
        assert response.status_code == 200
        assert client.get("/api/prospects").json()["items"][0]["consent_status"] == "opted_out"


@pytest.mark.parametrize("outcome", ["sent", "cancelled", "ambiguous"])
def test_old_handoff_cannot_overwrite_suppression(client, outcome):
    _, prospect, _, draft, handoff, headers = prepared_conversation(client)
    client.post(
        "/api/suppressions",
        headers=headers,
        json={
            "prospect_id": prospect,
            "reason": "Stop outreach",
        },
    )
    result = client.post(
        f"/api/handoffs/{handoff['id']}/outcome", headers=headers, json={"outcome": outcome}
    )
    assert result.status_code == 409
    assert fetch_one("SELECT state FROM drafts WHERE id=?", (draft,))["state"] == "suppressed"


@pytest.mark.parametrize("outcome", ["sent", "cancelled", "ambiguous"])
def test_old_handoff_cannot_overwrite_recorded_reply(client, outcome):
    _, _, _, draft, handoff, headers = prepared_conversation(client)
    assert (
        client.post(
            "/api/replies",
            headers=headers,
            json={
                "draft_id": draft,
                "body": "Here is my response.",
            },
        ).status_code
        == 201
    )
    result = client.post(
        f"/api/handoffs/{handoff['id']}/outcome", headers=headers, json={"outcome": outcome}
    )
    assert result.status_code == 409
    assert fetch_one("SELECT state FROM drafts WHERE id=?", (draft,))["state"] == "replied"


def test_handoff_key_cannot_be_reused_for_another_draft(client):
    _, _, _, draft, _, headers = prepared_conversation(client)
    response = client.post(f"/api/drafts/{draft + 999}/handoff", headers=headers, json={})
    assert response.status_code in (404, 409)


def test_pending_handoff_replay_contains_the_same_approved_message(client):
    _, _, _, draft, original, headers = prepared_conversation(client)
    replay = client.post(f"/api/drafts/{draft}/handoff", headers=headers, json={})
    assert replay.status_code == 200
    assert replay.json()["subject"] == original["subject"]
    assert replay.json()["body"] == original["body"]


@pytest.mark.parametrize("stop", ["pause", "opt_out", "archive"])
def test_replay_rechecks_current_permission(client, stop):
    campaign, prospect, _, draft, _, headers = prepared_conversation(client)
    if stop == "pause":
        client.post("/api/settings/pause", headers=headers, json={"paused": True})
    elif stop == "opt_out":
        client.post(
            "/api/suppressions",
            headers=headers,
            json={
                "prospect_id": prospect,
                "reason": "No more messages",
            },
        )
    else:
        client.patch(
            f"/api/campaigns/{campaign}/status", headers=headers, json={"status": "archived"}
        )
    replay = client.post(f"/api/drafts/{draft}/handoff", headers=headers, json={})
    assert replay.status_code == 409


def test_finalized_handoff_cannot_replay_after_approved_text_changes(client):
    _, _, _, draft, original, headers = prepared_conversation(client)
    client.post(
        f"/api/handoffs/{original['id']}/outcome", headers=headers, json={"outcome": "cancelled"}
    )
    client.patch(
        f"/api/drafts/{draft}",
        headers=headers,
        json={
            "subject": "Changed subject",
            "body": "Entirely changed message requiring another review.",
        },
    )
    assert client.post(f"/api/drafts/{draft}/handoff", headers=headers, json={}).status_code == 409


def test_legacy_suppression_is_checked_even_if_prospect_status_is_wrong(client):
    _, prospect, _, draft, _, headers = prepared_conversation(client)
    client.post(
        "/api/suppressions",
        headers=headers,
        json={"prospect_id": prospect, "reason": "Stop forever"},
    )
    # Model an existing inconsistent database; durable suppression remains authoritative.
    with transaction() as connection:
        connection.execute(
            "UPDATE prospects SET consent_status='consented' WHERE id=?", (prospect,)
        )
        connection.execute("UPDATE drafts SET state='needs_review' WHERE id=?", (draft,))
    review = client.post(
        f"/api/drafts/{draft}/review",
        headers=headers,
        json={
            "decision": "approve",
            "acknowledged_checks": APPROVAL_CHECKS,
        },
    )
    assert review.status_code == 409
    assert review.json()["error"]["code"] == "prospect_suppressed"


def test_malformed_template_returns_validation_instead_of_server_error(client):
    setup_owner(client)
    response = client.post(
        "/api/templates",
        headers=csrf_headers(client),
        json={
            "name": "Unbalanced template",
            "body": "Hello {name, this template has an unmatched brace.",
        },
    )
    assert response.status_code == 422


def test_validation_errors_do_not_echo_passwords(client):
    response = client.post(
        "/api/auth/setup",
        json={
            "display_name": "Owner",
            "workspace_name": "Workspace",
            "email": "owner@example.test",
            "password": "tiny-secret",
        },
    )
    assert response.status_code == 422
    assert "tiny-secret" not in response.text
