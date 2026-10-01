from __future__ import annotations

import json
import sqlite3
from contextlib import closing

import pytest
from app import db, main, privacy
from app.domain import APPROVAL_CHECKS
from app.security import hash_password
from conftest import csrf_headers, setup_owner
from test_outreach_invariants import prepared_conversation

OLD = "2020-01-01T00:00:00+00:00"
TEST_PASSPHRASE = "correct horse battery staple"  # noqa: S105 - fictional fixture
INVALID_PASSPHRASE = "incorrect"  # noqa: S105 - invalid fictional fixture


def legacy(event="prospect.suppressed", details=None, date=OLD, workspace=1):
    return db.execute(
        "INSERT INTO audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,details,created_at) VALUES (?,1,?,'fixture','7',?,?)",
        (
            workspace,
            event,
            details
            if isinstance(details, str)
            else json.dumps(details or {"reason": "Fictional private reason"}),
            date,
        ),
    )


def preview(client, after_id=0):
    response = client.post(
        "/api/privacy/audit/preview", headers=csrf_headers(client), json={"after_id": after_id}
    )
    assert response.status_code == 200, response.text
    return response.json()


def confirm(client, plan, path="/api/privacy/audit/confirm", **overrides):
    return client.post(
        path,
        headers=csrf_headers(client),
        json={
            "plan_id": plan["plan_id"],
            "current_password": TEST_PASSPHRASE,
            "confirmed": True,
            **overrides,
        },
    )


def test_exact_fields_core_history_and_operational_safety_are_preserved(client):
    _, prospect, _, draft, handoff, headers = prepared_conversation(client)
    reason = "Fictional personal restriction reason"
    assert (
        client.post(
            "/api/suppressions", headers=headers, json={"prospect_id": prospect, "reason": reason}
        ).status_code
        == 201
    )
    provider_url = "https://simbi.com/fictional-private?private=query"
    assert (
        client.post(
            "/api/settings/provider",
            headers=headers,
            json={"base_url": provider_url, "provider": "simbi"},
        ).status_code
        == 200
    )
    ids = [
        legacy(details={"reason": reason, "other_evidence": "keep"}),
        legacy("provider.updated", {"base_url": provider_url, "mode": "assisted"}),
        legacy(
            "draft.approved",
            {
                "checks": [*sorted(APPROVAL_CHECKS), "private extra", "source_authorized"],
                "content_hash": "a" * 64,
            },
        ),
        legacy("draft.declined", {"checks": ["private extra", "source_authorized"]}),
    ]
    rows = db.fetch_all("SELECT * FROM audit_events WHERE id IN (?,?,?,?) ORDER BY id", tuple(ids))
    before = client.get("/api/export").json()
    plan = preview(client)
    assert plan["counts"] == {"audit_events": 4}
    assert [event["id"] for event in plan["events"]] == ids
    assert [event["fields"] for event in plan["events"]] == [
        ["reason"],
        ["base_url"],
        ["checks"],
        ["checks"],
    ]
    stored = db.fetch_one("SELECT plan_json FROM privacy_cleanup_plans")["plan_json"]
    for text in [reason, provider_url, "private extra"]:
        assert text not in json.dumps(plan) and text not in stored
    assert not list(privacy.settings.backup_path.glob("*.db"))
    assert (
        db.fetch_all("SELECT * FROM audit_events WHERE id IN (?,?,?,?) ORDER BY id", tuple(ids))
        == rows
    )
    result = confirm(client, plan)
    assert result.status_code == 200, result.text
    receipt = result.json()
    assert receipt["kind"] == "audit_redaction" and receipt["counts"] == plan["counts"]
    changed = db.fetch_all(
        "SELECT * FROM audit_events WHERE id IN (?,?,?,?) ORDER BY id", tuple(ids)
    )
    for original, current in zip(rows, changed, strict=True):
        assert {key: value for key, value in original.items() if key != "details"} == {
            key: value for key, value in current.items() if key != "details"
        }
    assert json.loads(changed[0]["details"]) == {"other_evidence": "keep"}
    assert json.loads(changed[1]["details"]) == {"mode": "assisted"}
    assert json.loads(changed[2]["details"]) == {
        "checks": [*sorted(APPROVAL_CHECKS), "source_authorized"],
        "content_hash": "a" * 64,
    }
    assert json.loads(changed[3]["details"]) == {"checks": ["source_authorized"]}
    after = client.get("/api/export").json()
    for table in [
        "prospects",
        "campaigns",
        "templates",
        "drafts",
        "handoffs",
        "replies",
        "reminders",
        "suppressions",
    ]:
        assert after[table] == before[table]
    assert after["suppressions"][0]["reason"] == reason
    assert client.get("/api/settings").json()["providers"][0]["base_url"] == provider_url
    assert client.post(f"/api/drafts/{draft}/handoff", headers=headers, json={}).status_code == 409
    assert (
        db.fetch_one("SELECT status FROM handoffs WHERE id=?", (handoff["id"],))["status"]
        == "cancelled"
    )
    with closing(sqlite3.connect(privacy.settings.backup_path / receipt["backup_file"])) as backup:
        backup.row_factory = sqlite3.Row
        assert [
            dict(row)
            for row in backup.execute(
                "SELECT * FROM audit_events WHERE id IN (?,?,?,?) ORDER BY id", tuple(ids)
            )
        ] == rows
        assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert not backup.execute("PRAGMA foreign_key_check").fetchall()
    assert confirm(client, plan).json()["replayed"] is True
    assert len(list(privacy.settings.backup_path.glob("*.db"))) == 1
    assert (
        db.fetch_one(
            "SELECT COUNT(*) n FROM audit_events WHERE event_type='privacy.audit_minimized'"
        )["n"]
        == 1
    )
    assert client.get("/api/privacy/audit/receipts").json()["items"] == [receipt]
    assert receipt in client.get("/api/privacy/receipts").json()["items"]


@pytest.mark.parametrize(
    ("event", "details", "date"),
    [
        ("prospect.suppressed", {"reason": "private"}, db.now()),
        ("prospect.suppressed", {"reason": "private"}, "2020-01-01"),
        ("prospect.suppressed", {"reason": "private"}, "not-a-date"),
        ("prospect.suppressed", "not-json", OLD),
        ("prospect.suppressed", '["private"]', OLD),
        ("prospect.suppressed", '{"reason":"one","reason":"two"}', OLD),
        ("prospect.suppressed", '{"reason":"private","other":NaN}', OLD),
        ("prospect.suppressed", {"reason": ["private"]}, OLD),
        ("provider.updated", {"base_url": None}, OLD),
        ("draft.approved", {"checks": "private"}, OLD),
        ("draft.declined", {"checks": ["private", None]}, OLD),
    ],
)
def test_recent_ambiguous_or_malformed_entries_are_protected(client, event, details, date):
    setup_owner(client)
    event_id = legacy(event, details, date)
    original = db.fetch_one("SELECT * FROM audit_events WHERE id=?", (event_id,))
    plan = preview(client)
    assert plan["counts"]["audit_events"] == 0 and plan["protected_events"] == 1
    assert confirm(client, plan).status_code == 409
    assert db.fetch_one("SELECT * FROM audit_events WHERE id=?", (event_id,)) == original
    assert not list(privacy.settings.backup_path.glob("*.db"))


@pytest.mark.parametrize(
    "mutation",
    ["details", "entity", "actor", "date", "event", "deleted", "retention", "expiry", "preview"],
)
def test_changed_expired_and_replaced_plans_fail_closed(client, mutation):
    setup_owner(client)
    event_id = legacy()
    plan = preview(client)
    with db.transaction() as connection:
        if mutation == "deleted":
            connection.execute("DELETE FROM audit_events WHERE id=?", (event_id,))
        elif mutation == "retention":
            connection.execute("UPDATE workspaces SET retention_days=90")
        elif mutation == "expiry":
            connection.execute("UPDATE privacy_cleanup_plans SET expires_at=?", (OLD,))
        elif mutation != "preview":
            column, value = {
                "details": ("details", '{"reason":"changed"}'),
                "entity": ("entity_id", "8"),
                "actor": ("actor_user_id", None),
                "date": ("created_at", "2019-01-01T00:00:00+00:00"),
                "event": ("event_type", "provider.updated"),
            }[mutation]
            connection.execute(f"UPDATE audit_events SET {column}=? WHERE id=?", (value, event_id))
    if mutation == "preview":
        preview(client)
    assert confirm(client, plan).status_code == 409
    assert not list(privacy.settings.backup_path.glob("*.db"))
    assert not db.fetch_one(
        "SELECT id FROM audit_events WHERE event_type='privacy.audit_minimized'"
    )


def test_scope_guard_both_directions_including_completed_receipt(client):
    setup_owner(client)
    event_id = legacy()
    plan = preview(client)
    assert confirm(client, plan, path="/api/privacy/confirm").status_code == 409
    assert confirm(client, plan).status_code == 200
    assert confirm(client, plan, path="/api/privacy/confirm").status_code == 409
    ordinary = client.post(
        "/api/privacy/preview", headers=csrf_headers(client), json={"kind": "retention"}
    ).json()
    assert confirm(client, ordinary).status_code == 409
    assert db.fetch_one("SELECT id FROM audit_events WHERE id=?", (event_id,))


def test_backup_failure_and_late_sql_failure_roll_back_all_changes(client, monkeypatch):
    setup_owner(client)
    event_id = legacy()
    plan = preview(client)
    original = db.fetch_one("SELECT * FROM audit_events WHERE id=?", (event_id,))
    snapshot = db._snapshot

    def fail(*_args):
        raise OSError("fictional full disk")

    monkeypatch.setattr(db, "_snapshot", fail)
    result = confirm(client, plan)
    assert result.status_code == 503 and result.json()["error"]["code"] == "privacy_backup_failed"
    monkeypatch.setattr(db, "_snapshot", snapshot)
    with db.transaction() as connection:
        connection.execute(
            "CREATE TRIGGER fictional_audit_failure BEFORE UPDATE OF receipt_json ON privacy_cleanup_plans BEGIN SELECT RAISE(ABORT,'fictional receipt fault'); END"
        )
    assert confirm(client, plan).status_code == 409
    assert db.fetch_one("SELECT * FROM audit_events WHERE id=?", (event_id,)) == original
    assert db.fetch_one("SELECT receipt_json FROM privacy_cleanup_plans")["receipt_json"] is None
    assert not db.fetch_one(
        "SELECT id FROM audit_events WHERE event_type='privacy.audit_minimized'"
    )
    assert len(list(privacy.settings.backup_path.glob("*.db"))) == 1


@pytest.mark.parametrize("role", ["admin", "editor", "viewer"])
def test_current_owner_required_for_all_three_routes(client, role):
    setup_owner(client)
    legacy()
    plan = preview(client)
    db.execute("UPDATE memberships SET role=?", (role,))
    assert (
        client.post("/api/privacy/audit/preview", headers=csrf_headers(client), json={}).status_code
        == 403
    )
    assert confirm(client, plan).status_code == 403
    assert client.get("/api/privacy/audit/receipts").status_code == 403


def test_session_rechecked_inside_writer_even_with_cached_member(client):
    setup_owner(client)
    legacy()
    plan = preview(client)
    cached = client.get("/api/me").json()
    main.app.dependency_overrides[main.current_member] = lambda: cached
    try:
        db.execute("DELETE FROM sessions")
        assert confirm(client, plan).status_code == 403
        assert (
            client.post(
                "/api/privacy/audit/preview", headers=csrf_headers(client), json={}
            ).status_code
            == 403
        )
        assert client.get("/api/privacy/audit/receipts").status_code == 403
    finally:
        main.app.dependency_overrides.clear()


def test_password_ack_csrf_strict_input_and_shared_throttle(client):
    setup_owner(client)
    legacy()
    plan = preview(client)
    assert confirm(client, plan, confirmed=False).status_code == 422
    assert confirm(client, plan, current_password=INVALID_PASSPHRASE).status_code == 403
    assert (
        client.post(
            "/api/privacy/audit/confirm",
            json={
                "plan_id": plan["plan_id"],
                "current_password": TEST_PASSPHRASE,
                "confirmed": True,
            },
        ).status_code
        == 403
    )
    assert client.post("/api/privacy/audit/preview", json={}).status_code == 403
    for data in [{"after_id": -1}, {"after_id": 2**63}, {"kind": "prospect"}]:
        assert (
            client.post(
                "/api/privacy/audit/preview", headers=csrf_headers(client), json=data
            ).status_code
            == 422
        )
    for _ in range(main.settings.max_failed_logins):
        confirm(client, plan, current_password=INVALID_PASSPHRASE)
    assert confirm(client, plan).status_code == 429
    assert confirm(client, plan, path="/api/privacy/confirm").status_code == 429
    assert not list(privacy.settings.backup_path.glob("*.db"))


def test_scan_pagination_batching_and_workspace_isolation(client):
    setup_owner(client)
    with db.transaction() as connection:
        connection.execute(
            "INSERT INTO workspaces(id,name,created_at) VALUES (2,'Other',?)", (OLD,)
        )
        connection.executemany(
            "INSERT INTO audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,details,created_at) VALUES (1,1,'draft.approved','draft','7','{\"checks\":[\"source_authorized\"]}',?)",
            [(OLD,)] * 1000,
        )
    foreign = legacy(workspace=2)
    selected = [legacy() for _ in range(55)]
    other = legacy("handoff.prepared", {"content_hash": "b" * 64, "reason": "keep"})
    first = preview(client)
    assert first["scanned_events"] == first["unchanged_events"] == 1000
    assert first["counts"]["audit_events"] == 0 and first["has_more_events"]
    assert first["next_after_id"] < selected[0]
    second = preview(client, first["next_after_id"])
    assert not second["has_more_events"] and second["remaining_eligible_events"] == 5
    assert [event["id"] for event in second["events"]] == selected[:50]
    assert confirm(client, second).status_code == 200
    third = preview(client, first["next_after_id"])
    assert third["counts"]["audit_events"] == 5
    assert confirm(client, third).status_code == 200
    final = preview(client, first["next_after_id"])
    assert final["counts"]["audit_events"] == 0 and final["unchanged_events"] == 55
    assert (
        "Fictional private reason"
        in db.fetch_one("SELECT details FROM audit_events WHERE id=?", (foreign,))["details"]
    )
    assert (
        json.loads(
            db.fetch_one("SELECT details FROM audit_events WHERE id=?", (other,))["details"]
        )["reason"]
        == "keep"
    )


def test_reserved_writer_backup_and_maintenance_guard(client, monkeypatch):
    setup_owner(client)
    legacy()
    plan = preview(client)
    snapshot = db._snapshot

    def checked_snapshot(reader, destination):
        with closing(sqlite3.connect(db.settings.database_path, timeout=0)) as contender:
            with pytest.raises(sqlite3.OperationalError):
                contender.execute("BEGIN IMMEDIATE")
        return snapshot(reader, destination)

    monkeypatch.setattr(db, "_snapshot", checked_snapshot)
    with db.maintenance_operation_guard():
        assert confirm(client, plan).status_code == 409
    assert confirm(client, plan).status_code == 200


def test_deeply_nested_legacy_json_is_protected(client):
    setup_owner(client)
    details = '{"reason":"private","other":' + "[" * 2000 + "0" + "]" * 2000 + "}"
    event_id = legacy(details=details)
    plan = preview(client)
    assert plan["protected_events"] == 1 and not plan["events"]
    assert (
        db.fetch_one("SELECT details FROM audit_events WHERE id=?", (event_id,))["details"]
        == details
    )


def test_other_owner_cannot_use_or_discover_this_owners_plan_or_receipt(client):
    setup_owner(client)
    event_id = legacy()
    plan = preview(client)
    assert confirm(client, plan).status_code == 200
    with db.transaction() as connection:
        user_id = connection.execute(
            "INSERT INTO users(email,password_hash,display_name,created_at) VALUES ('other@example.test',?,'Other',?)",
            (hash_password(TEST_PASSPHRASE), db.now()),
        ).lastrowid
        workspace_id = connection.execute(
            "INSERT INTO workspaces(name,created_at) VALUES ('Other',?)", (db.now(),)
        ).lastrowid
        connection.execute(
            "INSERT INTO memberships(user_id,workspace_id,role) VALUES (?,?,'owner')",
            (user_id, workspace_id),
        )
    assert client.post("/api/auth/logout", headers=csrf_headers(client), json={}).status_code == 200
    assert (
        client.post(
            "/api/auth/login", json={"email": "other@example.test", "password": TEST_PASSPHRASE}
        ).status_code
        == 200
    )
    assert confirm(client, plan).status_code == 409
    assert client.get("/api/privacy/audit/receipts").json()["items"] == []
    assert preview(client)["scanned_events"] == 0
    assert db.fetch_one("SELECT id FROM audit_events WHERE id=?", (event_id,))


@pytest.mark.parametrize(("nested_lists", "protected"), [(63, False), (64, True)])
def test_explicit_detail_depth_boundary(client, nested_lists, protected):
    setup_owner(client)
    details = '{"reason":"private","other":' + "[" * nested_lists + "0" + "]" * nested_lists + "}"
    event_id = legacy(details=details)
    plan = preview(client)
    assert plan["protected_events"] == int(protected)
    assert plan["counts"]["audit_events"] == int(not protected)
    if not protected:
        assert confirm(client, plan).status_code == 200
        updated = json.loads(
            db.fetch_one("SELECT details FROM audit_events WHERE id=?", (event_id,))["details"]
        )
        assert "reason" not in updated and updated["other"] == json.loads(details)["other"]


@pytest.mark.parametrize(
    ("number", "protected"),
    [
        ("1e400", True),
        ("1e99999999999999999999999", True),
        ("0.12345678901234567890123456789", True),
        ("0.5", False),
    ],
)
def test_unknown_numeric_evidence_cannot_be_rounded_or_overflowed(client, number, protected):
    setup_owner(client)
    details = '{"reason":"private","score":' + number + "}"
    event_id = legacy(details=details)
    plan = preview(client)
    assert plan["protected_events"] == int(protected)
    assert plan["counts"]["audit_events"] == int(not protected)
    if protected:
        assert (
            db.fetch_one("SELECT details FROM audit_events WHERE id=?", (event_id,))["details"]
            == details
        )
    else:
        assert confirm(client, plan).status_code == 200
        assert json.loads(
            db.fetch_one("SELECT details FROM audit_events WHERE id=?", (event_id,))["details"]
        ) == {"score": 0.5}
