from __future__ import annotations

import pytest
from app.db import fetch_all, fetch_one, transaction
from app.domain import draft_edit_version
from conftest import csrf_headers, setup_owner
from test_critical_path import APPROVAL_CHECKS, create_foundation


def make_draft(client):
    setup_owner(client)
    campaign, prospect, template = create_foundation(client)
    response = client.post(
        "/api/drafts",
        headers=csrf_headers(client),
        json={"campaign_id": campaign, "prospect_id": prospect, "template_id": template},
    )
    assert response.status_code == 201
    return client.get("/api/drafts").json()["items"][0]


def stored_state(draft_id):
    return (
        fetch_one("SELECT * FROM drafts WHERE id=?", (draft_id,)),
        fetch_all("SELECT * FROM audit_events ORDER BY id"),
    )


def test_unversioned_save_cannot_overwrite_a_saved_draft(client):
    original = make_draft(client)
    before = stored_state(original["id"])
    response = client.patch(
        f"/api/drafts/{original['id']}",
        headers=csrf_headers(client),
        json={"subject": "Unversioned overwrite", "body": original["body"]},
    )
    assert response.status_code == 422
    assert stored_state(original["id"]) == before


@pytest.mark.parametrize("version", [None, "", "f" * 63, "f" * 65, "G" * 64, 123])
def test_malformed_edit_version_never_mutates(client, version):
    original = make_draft(client)
    before = stored_state(original["id"])
    response = client.patch(
        f"/api/drafts/{original['id']}",
        headers=csrf_headers(client),
        json={"subject": "Rejected malformed version", "body": original["body"], "expected_edit_version": version},
    )
    assert response.status_code == 422
    assert stored_state(original["id"]) == before


def test_same_text_review_transition_invalidates_edit_version(client):
    original = make_draft(client)
    approved = client.post(
        f"/api/drafts/{original['id']}/review",
        headers=csrf_headers(client),
        json={"decision": "approve", "acknowledged_checks": APPROVAL_CHECKS, "expected_content_hash": original["content_hash"]},
    )
    assert approved.status_code == 200
    before = stored_state(original["id"])
    stale = client.patch(
        f"/api/drafts/{original['id']}",
        headers=csrf_headers(client),
        json={"subject": "Stale pre-approval save", "body": original["body"], "expected_edit_version": original["edit_version"]},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "draft_save_conflict"
    assert stored_state(original["id"]) == before
    current = client.get(f"/api/drafts/{original['id']}").json()
    edited = client.patch(
        f"/api/drafts/{original['id']}",
        headers=csrf_headers(client),
        json={"subject": "Deliberate post-approval edit", "body": current["body"], "expected_edit_version": current["edit_version"]},
    )
    assert edited.status_code == 200
    assert edited.json()["state"] == "needs_review"
    assert edited.json()["reviewed_by"] is None
    assert edited.json()["approved_at"] is None


def test_version_encoding_binds_field_boundaries_record_workspace_and_state():
    original = {"workspace_id": 1, "id": 1, "updated_at": "2026-10-01", "state": "needs_review", "subject": "A\nB", "body": "C"}
    shifted = {**original, "subject": "A", "body": "B\nC"}
    assert original["subject"] + "\n" + original["body"] == shifted["subject"] + "\n" + shifted["body"]
    for other in [shifted, {**original, "id": 2}, {**original, "workspace_id": 2}, {**original, "state": "approved"}, {**original, "updated_at": "2026-10-02"}]:
        assert draft_edit_version(original) != draft_edit_version(other)
    assert draft_edit_version(original) == draft_edit_version(dict(original))


def test_concurrent_saves_have_one_winner_and_one_nonmutating_conflict(client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    original = make_draft(client)
    before_count = len(fetch_all("SELECT * FROM audit_events"))
    barrier = Barrier(2)
    headers = csrf_headers(client)

    def save(subject):
        barrier.wait(timeout=5)
        return client.patch(
            f"/api/drafts/{original['id']}",
            headers=headers,
            json={"subject": subject, "body": original["body"], "expected_edit_version": original["edit_version"]},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(save, ["Concurrent first", "Concurrent second"]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json() for response in responses if response.status_code == 200)
    assert fetch_one("SELECT subject FROM drafts WHERE id=?", (original["id"],))["subject"] == winner["subject"]
    assert len(fetch_all("SELECT * FROM audit_events")) == before_count + 1


def test_draft_detail_read_is_authenticated_owned_and_nonmutating(client):
    original = make_draft(client)
    before = stored_state(original["id"])
    detail = client.get(f"/api/drafts/{original['id']}")
    assert detail.status_code == 200
    assert detail.json() == original
    assert stored_state(original["id"]) == before
    with transaction() as connection:
        connection.execute("INSERT INTO workspaces(id,name,created_at) VALUES (101,'Other fictional workspace','2026-10-01')")
        connection.execute("UPDATE memberships SET workspace_id=101 WHERE user_id=1")
    hidden = client.get(f"/api/drafts/{original['id']}")
    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "not_found"
    assert stored_state(original["id"]) == before
    client.post("/api/auth/logout", headers=csrf_headers(client), json={})
    assert client.get(f"/api/drafts/{original['id']}").status_code == 401


@pytest.mark.parametrize("role", ["owner", "admin", "editor", "viewer"])
def test_detail_read_does_not_grant_edit_permission(client, role):
    original = make_draft(client)
    with transaction() as connection:
        connection.execute("UPDATE memberships SET role=? WHERE user_id=1", (role,))
    before = stored_state(original["id"])
    assert client.get(f"/api/drafts/{original['id']}").status_code == 200
    response = client.patch(
        f"/api/drafts/{original['id']}",
        headers=csrf_headers(client),
        json={"subject": "Permission-scoped change", "body": original["body"], "expected_edit_version": original["edit_version"]},
    )
    assert response.status_code == (403 if role == "viewer" else 200)
    if role == "viewer":
        assert response.json()["error"]["code"] == "permission_denied"
        assert stored_state(original["id"]) == before


def test_version_does_not_replace_csrf_or_owned_record_guards(client):
    original = make_draft(client)
    before = stored_state(original["id"])
    payload = {"subject": "Untrusted write", "body": original["body"], "expected_edit_version": original["edit_version"]}
    assert client.patch(f"/api/drafts/{original['id']}", json=payload).status_code == 403
    assert client.patch(f"/api/drafts/{original['id'] + 10000}", headers=csrf_headers(client), json=payload).status_code == 404
    assert stored_state(original["id"]) == before


@pytest.mark.parametrize("state", ["declined", "handoff_created", "ambiguous", "sent", "replied", "suppressed"])
def test_matching_version_cannot_bypass_a_locked_draft(client, state):
    original = make_draft(client)
    with transaction() as connection:
        connection.execute("UPDATE drafts SET state=? WHERE id=?", (state, original["id"]))
    current = client.get(f"/api/drafts/{original['id']}").json()
    before = stored_state(original["id"])
    response = client.patch(
        f"/api/drafts/{original['id']}",
        headers=csrf_headers(client),
        json={"subject": current["subject"], "body": current["body"], "expected_edit_version": current["edit_version"]},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "draft_locked"
    assert stored_state(original["id"]) == before


def test_stale_tab_save_preserves_newer_message_and_audit(client):
    original = make_draft(client)
    first = client.patch(
        f"/api/drafts/{original['id']}",
        headers=csrf_headers(client),
        json={
            "subject": "First tab saved this newer subject",
            "body": original["body"],
            "expected_edit_version": original["edit_version"],
        },
    )
    assert first.status_code == 200
    before = stored_state(original["id"])
    stale = client.patch(
        f"/api/drafts/{original['id']}",
        headers=csrf_headers(client),
        json={
            "subject": "Second tab must not overwrite it",
            "body": original["body"],
            "expected_edit_version": original["edit_version"],
        },
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "draft_save_conflict"
    assert stored_state(original["id"]) == before
    assert original["body"] not in stale.text
    current = client.get(f"/api/drafts/{original['id']}").json()
    assert current["subject"] == "First tab saved this newer subject"
    assert current["edit_version"] == first.json()["edit_version"]
    assert current["edit_version"] != original["edit_version"]


@pytest.mark.parametrize("state", ["needs_review", "approved"])
def test_exact_noop_save_preserves_review_timestamp_and_audit(client, state):
    original = make_draft(client)
    if state == "approved":
        approval = client.post(
            f"/api/drafts/{original['id']}/review",
            headers=csrf_headers(client),
            json={
                "decision": "approve",
                "acknowledged_checks": APPROVAL_CHECKS,
                "expected_content_hash": original["content_hash"],
            },
        )
        assert approval.status_code == 200
    current = client.get(f"/api/drafts/{original['id']}").json()
    before = stored_state(original["id"])
    response = client.patch(
        f"/api/drafts/{original['id']}",
        headers=csrf_headers(client),
        json={
            "subject": current["subject"],
            "body": current["body"],
            "expected_edit_version": current["edit_version"],
        },
    )
    assert response.status_code == 200
    assert response.json()["state"] == state
    assert response.json()["edit_version"] == current["edit_version"]
    assert stored_state(original["id"]) == before
