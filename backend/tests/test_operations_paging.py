import pytest
from app.db import transaction
from test_outreach_invariants import prepared_conversation


@pytest.mark.parametrize("resource", ["replies", "reminders", "audit"])
def test_operations_are_bounded_and_pageable(client, resource):
    _, prospect, _, draft, _, headers = prepared_conversation(client)
    if resource == "replies":
        client.post(
            "/api/replies",
            headers=headers,
            json={"draft_id": draft, "body": "Thank you for the offer"},
        )
        with transaction() as connection:
            for _ in range(4):
                connection.execute(
                    "INSERT INTO replies(workspace_id,draft_id,body,received_at,created_by,created_at) SELECT workspace_id,draft_id,body,received_at,created_by,created_at FROM replies LIMIT 1"
                )
    elif resource == "reminders":
        for i in range(5):
            assert (
                client.post(
                    "/api/reminders",
                    headers=headers,
                    json={
                        "prospect_id": prospect,
                        "title": f"Check {i}",
                        "due_at": "2026-09-10T12:00:00+00:00",
                    },
                ).status_code
                == 201
            )
    first = client.get(f"/api/{resource}?limit=2&offset=0").json()
    second = client.get(f"/api/{resource}?limit=2&offset=2").json()
    assert first["total"] >= 5
    assert first["limit"] == 2 and first["offset"] == 0
    assert len(first["items"]) == len(second["items"]) == 2
    assert not ({item["id"] for item in first["items"]} & {item["id"] for item in second["items"]})
    assert client.get(f"/api/{resource}?offset=-1").status_code == 422
