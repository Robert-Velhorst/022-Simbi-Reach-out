from __future__ import annotations

import json

import pytest
from app.hai import build_hai_feed, export_hai_feed
from conftest import csrf_headers, setup_owner
from test_critical_path import create_foundation


def create_review_draft(client) -> int:
    setup_owner(client)
    campaign_id, prospect_id, template_id = create_foundation(client)
    response = client.post(
        "/api/drafts",
        headers=csrf_headers(client),
        json={
            "campaign_id": campaign_id,
            "prospect_id": prospect_id,
            "template_id": template_id,
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_hai_feed_is_metadata_only_by_default(client, tmp_path):
    draft_id = create_review_draft(client)
    target, count, changed = export_hai_feed(tmp_path / "simbi.json")
    assert changed is True
    assert count == 1
    payload = json.loads(target.read_text(encoding="utf-8"))
    item = payload["items"][0]
    assert item["externalId"] == f"simbi-draft-{draft_id}"
    assert item["provider"] == "generic_json_feed"
    assert item["metadata"]["automaticSendingAllowed"] is False
    assert item["metadata"]["contentIncluded"] is False
    assert "Alex Morgan" not in item["content"]
    assert "Hello Alex" not in item["content"]
    assert export_hai_feed(target)[2] is False


def test_hai_feed_content_requires_explicit_opt_in(client):
    create_review_draft(client)
    item = build_hai_feed(include_content=True)["items"][0]
    assert item["metadata"]["contentIncluded"] is True
    assert "Alex Morgan" in item["content"]
    assert "Draft body:" in item["content"]


def test_hai_feed_rejects_non_json_destination(client, tmp_path):
    create_review_draft(client)
    with pytest.raises(ValueError, match="must be a .json file"):
        export_hai_feed(tmp_path / "simbi.txt")
