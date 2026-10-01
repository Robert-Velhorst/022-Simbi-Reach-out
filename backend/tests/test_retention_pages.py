from __future__ import annotations

import json
import sqlite3
from contextlib import closing

import pytest
from app import db, privacy
from conftest import csrf_headers, setup_owner
from test_privacy_cleanup import confirm

OLD = "2020-01-01T00:00:00+00:00"


def seed_contacts(count, *, created_at=OLD, workspace_id=1, start=0):
    with db.transaction() as connection:
        ids = []
        for number in range(start, start + count):
            ids.append(
                connection.execute(
                    "INSERT INTO prospects(workspace_id,name,source_url,created_at,updated_at) "
                    "VALUES (?,?,?,?,?)",
                    (
                        workspace_id,
                        f"Fixture {number}",
                        f"https://simbi.com/page-{number}",
                        created_at,
                        created_at,
                    ),
                ).lastrowid
            )
    return ids


def scan(client, after_id=0):
    return client.post(
        "/api/privacy/preview",
        headers=csrf_headers(client),
        json={"kind": "retention", "after_id": after_id},
    )


def test_more_than_one_thousand_contacts_have_an_exact_continuation(client):
    setup_owner(client)
    ids = seed_contacts(1001)
    result = scan(client)
    assert result.status_code == 200, result.text
    page = result.json()
    assert page["scanned_contacts"] == 1000
    assert page["counts"]["prospects"] == 50
    assert page["remaining_eligible_contacts"] == 950
    assert page["has_more_contacts"] is True
    assert page["next_after_id"] == ids[999]
    second = scan(client, page["next_after_id"])
    assert second.status_code == 200, second.text
    assert [item["id"] for item in second.json()["contacts"]] == [ids[1000]]
    assert second.json()["has_more_contacts"] is False
    assert db.fetch_one("SELECT COUNT(*) AS n FROM prospects")["n"] == 1001


def test_a_page_of_recent_contacts_does_not_hide_old_contacts_beyond_it(client):
    setup_owner(client)
    recent = seed_contacts(1000, created_at=db.now())
    old = seed_contacts(1, start=1000)
    result = scan(client)
    assert result.status_code == 200, result.text
    page = result.json()
    assert page["counts"]["prospects"] == 0
    assert page["scanned_contacts"] == page["protected_contacts"] == 1000
    assert page["next_after_id"] == recent[-1]
    result = scan(client, page["next_after_id"])
    assert result.status_code == 200, result.text
    assert [item["id"] for item in result.json()["contacts"]] == old


def test_repeated_batches_preserve_original_backup_restrictions_and_page_cursor(client):
    setup_owner(client)
    recent = seed_contacts(1000, created_at=db.now())
    old = seed_contacts(53, start=1000)
    page = scan(client, recent[-1]).json()
    assert page["counts"]["prospects"] == 50
    assert page["remaining_eligible_contacts"] == 3
    result = confirm(client, page["plan_id"])
    assert result.status_code == 200, result.text
    receipt = result.json()
    assert receipt["kind"] == "retention" and receipt["counts"]["prospects"] == 50
    with closing(sqlite3.connect(privacy.settings.backup_path / receipt["backup_file"])) as copy:
        assert copy.execute("SELECT COUNT(*) FROM prospects").fetchone()[0] == 1053
        assert copy.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert not copy.execute("PRAGMA foreign_key_check").fetchall()
    assert confirm(client, page["plan_id"]).json()["replayed"] is True
    assert len(list(privacy.settings.backup_path.glob("*.db"))) == 1
    remaining = scan(client, recent[-1]).json()
    assert [item["id"] for item in remaining["contacts"]] == old[50:]
    assert remaining["counts"]["prospects"] == 3
    assert remaining["after_id"] == recent[-1] and not remaining["has_more_contacts"]
    assert (
        db.fetch_one("SELECT COUNT(*) AS n FROM suppressions WHERE prospect_id IS NULL")["n"] == 50
    )
    assert db.fetch_one("SELECT COUNT(*) AS n FROM prospects")["n"] == 1003
    recreated = client.post(
        "/api/prospects",
        headers=csrf_headers(client),
        json={
            "name": "Recreated fictional identity",
            "source_url": "https://simbi.com/page-1000",
            "consent_status": "consented",
        },
    )
    assert recreated.status_code == 201, recreated.text
    assert (
        db.fetch_one("SELECT consent_status FROM prospects WHERE id=?", (recreated.json()["id"],))[
            "consent_status"
        ]
        == "opted_out"
    )


@pytest.mark.parametrize("value", [-1, 9223372036854775808, "1", 1.5, True, None])
def test_scan_cursor_is_a_strict_sqlite_integer(client, value):
    setup_owner(client)
    response = scan(client, value)
    assert response.status_code == 422
    assert not db.fetch_one("SELECT id FROM privacy_cleanup_plans")


def test_maximum_cursor_empty_page_and_restart_are_honest(client):
    setup_owner(client)
    selected = seed_contacts(1)[0]
    page = scan(client, 9223372036854775807).json()
    assert page["scanned_contacts"] == page["counts"]["prospects"] == 0
    assert page["next_after_id"] is None and not page["has_more_contacts"]
    assert scan(client).json()["contacts"][0]["id"] == selected


@pytest.mark.parametrize("kind", ["prospect", "campaign", "template"])
def test_cursor_is_not_accepted_for_a_named_record_scope(client, kind):
    setup_owner(client)
    response = client.post(
        "/api/privacy/preview",
        headers=csrf_headers(client),
        json={
            "kind": kind,
            f"{kind}_id": 1,
            "after_id": 0,
        },
    )
    assert response.status_code == 422
    assert not db.fetch_one("SELECT id FROM privacy_cleanup_plans")


@pytest.mark.parametrize(
    "column,value",
    [
        ("created_at", ""),
        ("updated_at", ""),
        ("updated_at", "invalid"),
        ("updated_at", "2020-01-01T00:00:00"),
        ("created_at", "not-a-date"),
    ],
)
def test_invalid_or_missing_activity_is_protected_without_hiding_other_contacts(
    client, column, value
):
    setup_owner(client)
    protected, eligible = seed_contacts(2)
    with db.transaction() as connection:
        connection.execute(f"UPDATE prospects SET {column}=? WHERE id=?", (value, protected))
    page = scan(client).json()
    assert page["protected_contacts"] == 1
    assert [item["id"] for item in page["contacts"]] == [eligible]
    assert db.fetch_one("SELECT id FROM prospects WHERE id=?", (protected,))


@pytest.mark.parametrize("events,protected", [(999, False), (1000, True)])
def test_exact_history_boundary_is_bounded_and_other_contacts_remain_reachable(
    client, events, protected
):
    setup_owner(client)
    selected, other = seed_contacts(2)
    with db.transaction() as connection:
        connection.executemany(
            "INSERT INTO audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,details,created_at) "
            "VALUES (1,1,'fixture.old','prospect',?,'{}',?)",
            [(str(selected), OLD)] * events,
        )
    page = scan(client).json()
    assert page["protected_contacts"] == page["oversized_contacts"] == int(protected)
    assert [item["id"] for item in page["contacts"]] == (
        [other] if protected else [selected, other]
    )
    direct = client.post(
        "/api/privacy/preview",
        headers=csrf_headers(client),
        json={"kind": "prospect", "prospect_id": selected},
    )
    assert direct.status_code == (409 if protected else 200), direct.text
    if protected:
        assert direct.json()["error"]["code"] == "privacy_scan_limit"


def test_oversized_or_inconsistent_histories_are_not_deletable_after_preview(client):
    setup_owner(client)
    selected = seed_contacts(1)[0]
    page = scan(client).json()
    with db.transaction() as connection:
        connection.executemany(
            "INSERT INTO audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,details,created_at) "
            "VALUES (1,1,'fixture.old','prospect',?,'{}',?)",
            [(str(selected), OLD)] * 1000,
        )
    response = confirm(client, page["plan_id"])
    assert (
        response.status_code == 409
        and response.json()["error"]["code"] == "privacy_preview_changed"
    )
    assert db.fetch_one("SELECT id FROM prospects WHERE id=?", (selected,))
    assert not list(privacy.settings.backup_path.glob("*.db"))


def test_large_registry_is_hashed_once_not_copied_into_each_contact_graph(client):
    setup_owner(client)
    selected = seed_contacts(2)
    with db.transaction() as connection:
        connection.executemany(
            "INSERT INTO suppressions(workspace_id,normalized_value,reason,created_by,created_at) VALUES (1,?,'Private registry reason',1,?)",
            [(f"simbi:https://simbi.com/retained-{number}", OLD) for number in range(1001)],
        )
        history = privacy.graph(connection, 1, selected[0])
        assert "suppressions" not in history
    page = scan(client).json()
    assert page["counts"]["prospects"] == 2 and page["protected_contacts"] == 0
    plan = json.loads(db.fetch_one("SELECT plan_json FROM privacy_cleanup_plans")["plan_json"])
    assert "Private registry reason" not in json.dumps(plan)
    with db.transaction() as connection:
        connection.execute("UPDATE suppressions SET reason='Changed reason' WHERE id=1001")
    response = confirm(client, page["plan_id"])
    assert (
        response.status_code == 409
        and response.json()["error"]["code"] == "privacy_preview_changed"
    )


def test_cleanup_cannot_overlap_managed_worker_or_hai_export(client):
    setup_owner(client)
    selected = seed_contacts(1)[0]
    page = scan(client).json()
    with db.maintenance_operation_guard():
        result = confirm(client, page["plan_id"])
        assert result.status_code == 409 and result.json()["error"]["code"] == "maintenance_busy"
        assert db.fetch_one("SELECT id FROM prospects WHERE id=?", (selected,))
        assert not list(privacy.settings.backup_path.glob("*.db"))
    assert confirm(client, page["plan_id"]).status_code == 200


def test_reference_lookup_recovers_a_real_receipt_outside_the_last_ten_without_writes(client):
    setup_owner(client)
    receipts = []
    for number in range(11):
        seed_contacts(1, start=2000 + number)
        page = scan(client).json()
        result = confirm(client, page["plan_id"])
        assert result.status_code == 200, result.text
        receipts.append(result.json())
        # Deterministic chronology even on a fast machine; receipt content stays intact.
        with db.transaction() as connection:
            connection.execute(
                "UPDATE privacy_cleanup_plans SET created_at=? WHERE id=?",
                (f"2020-01-{number + 1:02d}T00:00:00+00:00", page["plan_id"]),
            )
    assert len(list(privacy.settings.backup_path.glob("*.db"))) == 11
    latest = client.get("/api/privacy/receipts").json()["items"]
    assert len(latest) == 10
    assert receipts[0]["plan_id"] not in {item["plan_id"] for item in latest}
    before = {
        table: db.fetch_all(f"SELECT * FROM {table}")
        for table in ("privacy_cleanup_plans", "audit_events", "suppressions", "prospects")
    }
    result = client.get(f"/api/privacy/receipts/{receipts[0]['plan_id']}")
    assert result.status_code == 200 and result.json() == receipts[0]
    assert before == {table: db.fetch_all(f"SELECT * FROM {table}") for table in before}
    assert len(list(privacy.settings.backup_path.glob("*.db"))) == 11


@pytest.mark.parametrize("role", ["viewer", "editor", "admin"])
def test_reference_lookup_requires_the_current_owner_role(client, role):
    setup_owner(client)
    seed_contacts(1)
    receipt = confirm(client, scan(client).json()["plan_id"]).json()
    with db.transaction() as connection:
        connection.execute("UPDATE memberships SET role=?", (role,))
    assert client.get(f"/api/privacy/receipts/{receipt['plan_id']}").status_code == 403


@pytest.mark.parametrize("reference", ["pending", "0" * 32, "INVALID", "a" * 33])
def test_reference_lookup_does_not_claim_completion_for_pending_or_unknown_references(
    client, reference
):
    setup_owner(client)
    seed_contacts(1)
    page = scan(client).json()
    reference = page["plan_id"] if reference == "pending" else reference
    result = client.get(f"/api/privacy/receipts/{reference}")
    assert result.status_code == 404
    assert result.json()["error"]["code"] == "privacy_receipt_not_found"
    assert "Absence is not proof of failure" in result.json()["error"]["message"]
    assert db.fetch_one("SELECT COUNT(*) AS n FROM prospects")["n"] == 1
    assert not list(privacy.settings.backup_path.glob("*.db"))


@pytest.mark.parametrize("column", ["workspace_id", "owner_id"])
def test_reference_lookup_does_not_disclose_foreign_owner_or_workspace_receipts(client, column):
    setup_owner(client)
    seed_contacts(1)
    receipt = confirm(client, scan(client).json()["plan_id"]).json()
    with db.transaction() as connection:
        workspace_id = connection.execute(
            "INSERT INTO workspaces(name,created_at) VALUES ('Other fixture',?)", (db.now(),)
        ).lastrowid
        user_id = connection.execute(
            "INSERT INTO users(email,display_name,password_hash,created_at) VALUES ('other@example.test','Other fixture','unused',?)",
            (db.now(),),
        ).lastrowid
        connection.execute(
            f"UPDATE privacy_cleanup_plans SET {column}=? WHERE id=?",
            (workspace_id if column == "workspace_id" else user_id, receipt["plan_id"]),
        )
    result = client.get(f"/api/privacy/receipts/{receipt['plan_id']}")
    assert result.status_code == 404
    assert result.json()["error"]["code"] == "privacy_receipt_not_found"
