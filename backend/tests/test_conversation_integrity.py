from __future__ import annotations

import pytest
from app.db import fetch_all, fetch_one, now, transaction
from app.timestamps import timestamp_sort_key
from conftest import csrf_headers
from test_creation_confirmations import foundation


def test_reminder_cannot_name_a_different_contact_from_its_conversation(client):
    draft, *_ = foundation(client)
    other = client.post(
        "/api/prospects", headers=csrf_headers(client),
        json={"name": "Different fictional contact", "source_url": "https://simbi.com/fictional-other"},
    )
    assert other.status_code == 201
    before = {table: fetch_all(f"SELECT * FROM {table} ORDER BY id") for table in ("reminders", "drafts", "audit_events")}
    response = client.post(
        "/api/reminders", headers=csrf_headers(client),
        json={"draft_id": draft["id"], "prospect_id": other.json()["id"],
              "title": "Fictional mismatch", "due_at": "2026-10-02T12:00:00Z"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "reminder_target_mismatch"
    assert before == {table: fetch_all(f"SELECT * FROM {table} ORDER BY id") for table in before}


@pytest.mark.parametrize("target", ["draft_id", "prospect_id"])
def test_reminder_missing_target_is_not_treated_as_a_relationship_mismatch(client, target):
    draft, _, prospect, _ = foundation(client)
    payload = {"draft_id": draft["id"], "prospect_id": prospect,
               "title": "Fictional missing target", "due_at": "2026-10-02T12:00:00Z", target: 999999}
    before = fetch_one("SELECT COUNT(*) AS n FROM audit_events")["n"]
    response = client.post("/api/reminders", headers=csrf_headers(client), json=payload)
    assert response.status_code == 404
    assert fetch_one("SELECT COUNT(*) AS n FROM reminders")["n"] == 0
    assert fetch_one("SELECT COUNT(*) AS n FROM audit_events")["n"] == before


@pytest.mark.parametrize("target", ["draft_id", "prospect_id"])
def test_reminder_checks_both_workspace_owners_before_relationship(client, target):
    draft, _, prospect, _ = foundation(client)
    with transaction() as connection:
        workspace = connection.execute("INSERT INTO workspaces(name,created_at) VALUES ('Fictional private workspace',?)", (now(),)).lastrowid
        campaign = connection.execute(
            "INSERT INTO campaigns(workspace_id,name,purpose,lawful_basis,created_at,updated_at) VALUES (?,?,?,?,?,?)",
            (workspace, "Private fictional campaign", "Local test", "Fictional", now(), now()),
        ).lastrowid
        private_prospect = connection.execute(
            "INSERT INTO prospects(workspace_id,name,source_url,created_at,updated_at) VALUES (?,?,?,?,?)",
            (workspace, "Private fictional contact", "https://simbi.com/private-fictional", now(), now()),
        ).lastrowid
        private_draft = connection.execute(
            "INSERT INTO drafts(workspace_id,campaign_id,prospect_id,body,quality_score,created_at,updated_at) VALUES (?,?,?,'Fictional private draft',90,?,?)",
            (workspace, campaign, private_prospect, now(), now()),
        ).lastrowid
    payload = {"draft_id": draft["id"], "prospect_id": prospect,
               "title": "Fictional foreign target", "due_at": "2026-10-02T12:00:00Z"}
    payload[target] = private_draft if target == "draft_id" else private_prospect
    before = {table: fetch_all(f"SELECT * FROM {table} ORDER BY id") for table in ("reminders", "drafts", "audit_events")}
    response = client.post("/api/reminders", headers=csrf_headers(client), json=payload)
    assert response.status_code == 404
    assert response.json()["error"]["code"] != "reminder_target_mismatch"
    assert before == {table: fetch_all(f"SELECT * FROM {table} ORDER BY id") for table in before}


# Deliberately not sorted text: old offsets, Z, varying fractions, equal instants,
# adjacent microseconds and invalid legacy values. Reads must never repair history.
TIMES = [
    "2026-10-02T00:00:00+02:00",  # October 1, 22:00 UTC
    "2026-10-01T23:00:00Z",
    "2026-10-01T22:30:00.123457+00:00",
    "2026-10-01T22:30:00.123456+00:00",
    "2026-10-01T22:30:00Z",
    "2026-10-01T23:30:00.000000+01:00",  # same instant as previous row
    "2026-10-01T22:30:00.1Z",
    "2026-02-30T12:00:00Z",
    "2026-10-01T12:00:00",  # no timezone: do not invent one
    "",
]


@pytest.mark.parametrize("table,field", [("replies", "received_at"), ("reminders", "due_at")])
def test_conversation_lists_order_instants_then_id_without_rewriting_legacy_rows(client, table, field):
    draft, *_ = foundation(client)
    stored_draft = fetch_one("SELECT * FROM drafts WHERE id=?", (draft["id"],))
    user = fetch_one("SELECT id FROM users ORDER BY id LIMIT 1")["id"]
    ids = []
    with transaction() as connection:
        for value in TIMES:
            if table == "replies":
                row_id = connection.execute(
                    "INSERT INTO replies(workspace_id,draft_id,body,received_at,created_by,created_at) VALUES (?,?,?,?,?,?)",
                    (stored_draft["workspace_id"], draft["id"], "Fictional legacy reply", value, user, now()),
                ).lastrowid
            else:
                row_id = connection.execute(
                    "INSERT INTO reminders(workspace_id,draft_id,title,due_at,created_by,created_at) VALUES (?,?,?,?,'user',?)",
                    (stored_draft["workspace_id"], draft["id"], "Fictional legacy reminder", value, now()),
                ).lastrowid
            ids.append(row_id)
        other_workspace = connection.execute(
            "INSERT INTO workspaces(name,created_at) VALUES ('Fictional other workspace',?)", (now(),),
        ).lastrowid
        # Even a legacy cross-workspace link must not leak through ordering/joining.
        if table == "replies":
            connection.execute(
                "INSERT INTO replies(workspace_id,draft_id,body,received_at,created_by,created_at) VALUES (?,?,?,?,?,?)",
                (other_workspace, draft["id"], "Private foreign fixture", TIMES[1], user, now()),
            )
        else:
            connection.execute(
                "INSERT INTO reminders(workspace_id,draft_id,title,due_at,created_by,created_at) VALUES (?,?,?,?,'user',?)",
                (other_workspace, draft["id"], "Private foreign fixture", TIMES[0], now()),
            )
    before = {name: fetch_all(f"SELECT * FROM {name} ORDER BY id") for name in (table, "drafts", "audit_events")}
    order = [1, 2, 3, 6, 5, 4, 0, 9, 8, 7] if table == "replies" else [0, 4, 5, 6, 3, 2, 1, 7, 8, 9]
    actual = []
    for offset in range(0, len(ids) + 1, 3):
        response = client.get(f"/api/{table}?limit=3&offset={offset}")
        assert response.status_code == 200
        page = response.json()
        assert (page["total"], page["limit"], page["offset"]) == (len(ids), 3, offset)
        assert len(page["items"]) <= 3
        actual.extend(page["items"])
    assert [row["id"] for row in actual] == [ids[index] for index in order]
    assert {row["id"]: row[field] for row in actual} == dict(zip(ids, TIMES, strict=True))
    assert before == {name: fetch_all(f"SELECT * FROM {name} ORDER BY id") for name in before}


@pytest.mark.parametrize("status", ["done", "cancelled"])
def test_reminder_ordering_keeps_status_filter_and_count(client, status):
    draft, *_ = foundation(client)
    workspace = fetch_one("SELECT workspace_id FROM drafts WHERE id=?", (draft["id"],))["workspace_id"]
    with transaction() as connection:
        ids = []
        for value, row_status in [(TIMES[1], status), (TIMES[0], "open"), (TIMES[0], status)]:
            ids.append(connection.execute(
                "INSERT INTO reminders(workspace_id,draft_id,title,due_at,status,created_by,created_at) VALUES (?,?,?,?,?,'user',?)",
                (workspace, draft["id"], "Fictional filtered reminder", value, row_status, now()),
            ).lastrowid)
    response = client.get(f"/api/reminders?status={status}&limit=1&offset=1")
    assert response.status_code == 200
    page = response.json()
    assert (page["total"], page["limit"], page["offset"]) == (2, 1, 1)
    assert [row["id"] for row in page["items"]] == [ids[0]]
    assert page["items"][0]["status"] == status


def test_overview_uses_the_same_reminder_order_and_due_instants(client, monkeypatch):
    from app import main

    draft, *_ = foundation(client)
    workspace = fetch_one("SELECT workspace_id FROM drafts WHERE id=?", (draft["id"],))["workspace_id"]
    monkeypatch.setattr(main, "now", lambda: "2026-10-01T22:30:00+00:00")
    with transaction() as connection:
        ids = [connection.execute(
            "INSERT INTO reminders(workspace_id,draft_id,title,due_at,created_by,created_at) VALUES (?,?,?,?,'user',?)",
            (workspace, draft["id"], "Fictional overview reminder", value, now()),
        ).lastrowid for value in TIMES[:-1]]
        connection.execute(
            "INSERT INTO reminders(workspace_id,draft_id,title,due_at,status,created_by,created_at) VALUES (?,?,?,?,'done','user',?)",
            (workspace, draft["id"], "Fictional done reminder", TIMES[0], now()),
        )
    before = fetch_all("SELECT * FROM reminders ORDER BY id")
    response = client.get("/api/overview")
    assert response.status_code == 200
    result = response.json()
    assert result["counts"]["due"] == 3  # at/before now; invalid/unknown times do not imply due
    assert [row["id"] for row in result["reminders"]] == [ids[index] for index in [0, 4, 5, 6, 3]]
    assert before == fetch_all("SELECT * FROM reminders ORDER BY id")


@pytest.mark.parametrize("value", [
    None, 0, 1.5, b"2026-10-01T12:00:00Z", "", "not-a-date",
    "2026-02-30T12:00:00Z", "2026-10-01T12:00:00", "2026-10-01",
    "2026-10-01T12:00:00.1234567Z", "2026-10-01T24:00:00Z",
    "0001-01-01T00:00:00+01:00", "9999-12-31T23:00:00-02:00",
])
def test_uninterpretable_legacy_timestamp_has_no_sort_key(value):
    assert timestamp_sort_key(value) is None


@pytest.mark.parametrize("value,expected", [
    ("2026-10-02T00:00:00+02:00", "2026-10-01T22:00:00.000000+00:00"),
    ("2026-10-01T22:30:00.123456Z", "2026-10-01T22:30:00.123456+00:00"),
    ("2026-10-01T22:30:00.1-00:30", "2026-10-01T23:00:00.100000+00:00"),
    ("0001-01-01T00:00:00Z", "0001-01-01T00:00:00.000000+00:00"),
    ("9999-12-31T23:59:59.999999Z", "9999-12-31T23:59:59.999999+00:00"),
])
def test_read_key_preserves_microseconds_offset_and_four_digit_year(value, expected):
    assert timestamp_sort_key(value) == expected
