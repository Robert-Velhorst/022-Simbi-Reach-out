from __future__ import annotations

import pytest
from app.db import fetch_one, transaction
from conftest import csrf_headers, setup_owner
from test_critical_path import create_foundation


def foundation(client):
    setup_owner(client)
    campaign, prospect, template = create_foundation(client)
    response = client.post(
        "/api/drafts", headers=csrf_headers(client),
        json={"campaign_id": campaign, "prospect_id": prospect, "template_id": template},
    )
    assert response.status_code == 201
    return response.json(), campaign, prospect, template


def test_draft_confirmation_identifies_the_stored_selections(client):
    result, campaign, prospect, template = foundation(client)
    assert {key: result[key] for key in ("campaign_id", "prospect_id", "template_id")} == {
        "campaign_id": campaign, "prospect_id": prospect, "template_id": template,
    }
    stored = fetch_one("SELECT * FROM drafts WHERE id=?", (result["id"],))
    for key in ("campaign_id", "prospect_id", "template_id", "state", "quality_score"):
        assert result[key] == stored[key]


def test_reply_confirmation_contains_stored_text_target_and_normalized_time(client):
    draft, *_ = foundation(client)
    with transaction() as connection:
        connection.execute("UPDATE drafts SET state='ambiguous' WHERE id=?", (draft["id"],))
    result = client.post(
        "/api/replies", headers=csrf_headers(client),
        json={"draft_id": draft["id"], "body": "  Fictional reply  ", "received_at": "2026-10-01T15:00:00.123456+02:00"},
    )
    assert result.status_code == 201
    result = result.json()
    stored = fetch_one("SELECT * FROM replies WHERE id=?", (result["id"],))
    assert result["state"] == "replied"
    for key in ("draft_id", "body", "received_at"):
        assert result[key] == stored[key]
    assert result["draft_id"] == draft["id"]
    assert result["body"] == "Fictional reply"
    assert result["received_at"] == "2026-10-01T13:00:00.123456+00:00"


@pytest.mark.parametrize("target", ["draft", "prospect", "both"])
def test_reminder_confirmation_matches_stored_targets_title_and_instant(client, target):
    draft, _, prospect, _ = foundation(client)
    payload = {"title": "  Fictional reminder  ", "due_at": "2026-10-02T15:00:00+02:00"}
    if target in {"draft", "both"}:
        payload["draft_id"] = draft["id"]
    if target in {"prospect", "both"}:
        payload["prospect_id"] = prospect
    response = client.post("/api/reminders", headers=csrf_headers(client), json=payload)
    assert response.status_code == 201
    result = response.json()
    stored = fetch_one("SELECT * FROM reminders WHERE id=?", (result["id"],))
    for key in ("draft_id", "prospect_id", "title", "due_at", "status"):
        assert result[key] == stored[key]
    assert result["draft_id"] == payload.get("draft_id")
    assert result["prospect_id"] == payload.get("prospect_id")
    assert result["title"] == "Fictional reminder"
    assert result["due_at"] == "2026-10-02T13:00:00.000000+00:00"


@pytest.mark.parametrize("path,field", [("/api/replies", "received_at"), ("/api/reminders", "due_at")])
@pytest.mark.parametrize("timestamp", ["not-a-date", "2026-02-30T12:00:00Z", "2026-10-01T12:00:00", "2026-10-01", "2026-10-01T12:00:00+00:60", "2026-10-01T24:00:00Z"])
def test_invalid_or_timezone_free_time_is_rejected_before_any_write(client, path, field, timestamp):
    draft, *_ = foundation(client)
    with transaction() as connection:
        connection.execute("UPDATE drafts SET state='ambiguous' WHERE id=?", (draft["id"],))
    before = {table: fetch_one(f"SELECT COUNT(*) AS n FROM {table}")["n"] for table in ("replies", "reminders", "audit_events")}
    payload = {"draft_id": draft["id"], field: timestamp}
    payload["body" if path.endswith("replies") else "title"] = "Fictional text"
    response = client.post(path, headers=csrf_headers(client), json=payload)
    assert response.status_code == 422
    assert before == {table: fetch_one(f"SELECT COUNT(*) AS n FROM {table}")["n"] for table in before}
    assert fetch_one("SELECT state FROM drafts WHERE id=?", (draft["id"],))["state"] == "ambiguous"


@pytest.mark.parametrize("path,field", [("/api/drafts", "campaign_id"), ("/api/replies", "draft_id"), ("/api/reminders", "draft_id")])
@pytest.mark.parametrize("invalid", [True, "1", 0])
def test_creation_targets_must_be_actual_positive_json_integers(client, path, field, invalid):
    draft, campaign, prospect, template = foundation(client)
    with transaction() as connection:
        connection.execute("UPDATE drafts SET state='ambiguous' WHERE id=?", (draft["id"],))
    payloads = {
        "/api/drafts": {"campaign_id": campaign, "prospect_id": prospect, "template_id": template},
        "/api/replies": {"draft_id": draft["id"], "body": "Fictional reply"},
        "/api/reminders": {"draft_id": draft["id"], "title": "Fictional reminder", "due_at": "2026-10-02T12:00:00Z"},
    }
    payload = {**payloads[path], field: invalid}
    before = {table: fetch_one(f"SELECT COUNT(*) AS n FROM {table}")["n"] for table in ("drafts", "replies", "reminders", "audit_events")}
    response = client.post(path, headers=csrf_headers(client), json=payload)
    assert response.status_code == 422
    assert before == {table: fetch_one(f"SELECT COUNT(*) AS n FROM {table}")["n"] for table in before}
