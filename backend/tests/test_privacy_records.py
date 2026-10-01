"""Deletion is exercised only against the isolated test database."""

import sqlite3
from contextlib import closing

import pytest
from app import db, privacy
from conftest import csrf_headers, setup_owner
from test_critical_path import create_foundation
from test_privacy_cleanup import aged_conversation, confirm


def preview_record(client, kind, record_id):
    return client.post(
        "/api/privacy/preview",
        headers=csrf_headers(client),
        json={"kind": kind, f"{kind}_id": record_id},
    )


def test_campaign_removal_preserves_contact_other_history_and_restrictions(client):
    setup_owner(client)
    campaign, prospect, template, draft = aged_conversation(client)
    with db.transaction() as connection:
        connection.execute(
            "INSERT INTO campaigns(workspace_id,name,purpose,lawful_basis,created_at,updated_at) "
            "VALUES (1,'Other campaign','Other purpose','Reviewed context',?,?)",
            (db.now(), db.now()),
        )
        other_campaign = connection.execute("SELECT max(id) FROM campaigns").fetchone()[0]
        connection.execute(
            "INSERT INTO drafts(workspace_id,campaign_id,prospect_id,body,quality_score,created_at,updated_at) "
            "VALUES (1,?,?,'Other private conversation',90,?,?)",
            (other_campaign, prospect, db.now(), db.now()),
        )
        connection.execute(
            "INSERT INTO reminders(workspace_id,prospect_id,title,due_at,created_by,created_at) "
            "VALUES (1,?,'Contact-only reminder',?,'user',?)",
            (prospect, db.now(), db.now()),
        )
        connection.execute(
            "INSERT INTO reminders(workspace_id,draft_id,prospect_id,title,due_at,created_by,created_at) "
            "VALUES (1,?,?,'Selected conversation reminder',?,'user',?)",
            (draft, prospect, db.now(), db.now()),
        )
    before = client.get("/api/export").json()
    response = preview_record(client, "campaign", campaign)
    assert response.status_code == 200, response.text
    plan = response.json()
    assert plan["records"] == [{"id": campaign, "name": "Community help"}]
    assert plan["counts"] == {
        "prospects": 0,
        "campaigns": 1,
        "restricted_contacts": 1,
        "drafts": 1,
        "handoffs": 0,
        "replies": 1,
        "reminders": 1,
    }
    assert plan["restricted_contacts"] == [{"id": prospect, "name": "Alex Morgan"}]
    assert client.get("/api/export").json()["drafts"] == before["drafts"]
    receipt = confirm(client, plan["plan_id"]).json()
    assert receipt["kind"] == "campaign"
    after = client.get("/api/export").json()
    assert after["prospects"] == before["prospects"] and after["templates"] == before["templates"]
    assert len(after["campaigns"]) == len(after["drafts"]) == len(after["reminders"]) == 1
    assert after["drafts"][0]["body"] == "Other private conversation"
    assert after["reminders"][0]["title"] == "Contact-only reminder"
    assert after["suppressions"][0]["prospect_id"] == prospect
    assert not db.fetch_one("SELECT id FROM replies")
    with closing(
        sqlite3.connect(privacy.settings.backup_path / receipt["backup_file"])
    ) as connection:
        assert connection.execute("SELECT COUNT(*) FROM campaigns").fetchone()[0] == 2
        assert connection.execute("SELECT COUNT(*) FROM replies").fetchone()[0] == 1
    assert confirm(client, plan["plan_id"]).json()["replayed"] is True
    assert len(list(privacy.settings.backup_path.glob("*.db"))) == 1
    # Removing the campaign must not clear cooldown/duplicate protection.
    from app.main import is_suppressed

    with db.transaction() as connection:
        row = connection.execute("SELECT * FROM prospects WHERE id=?", (prospect,)).fetchone()
        assert is_suppressed(connection, 1, row["provider"], row["source_url"])
    assert db.fetch_one("SELECT id FROM templates WHERE id=?", (template,))


def test_template_removal_only_clears_links_not_reviewed_content_or_handoffs(client):
    setup_owner(client)
    _, _, template, draft = aged_conversation(client)
    with db.transaction() as connection:
        connection.execute(
            "UPDATE drafts SET state='handoff_created',approved_at=? WHERE id=?", (db.now(), draft)
        )
        connection.execute(
            "INSERT INTO handoffs(workspace_id,draft_id,idempotency_key,provider_url,content_hash,prepared_at) "
            "VALUES (1,?,'fictional-template','https://simbi.com/','unchanged-hash',?)",
            (draft, db.now()),
        )
    before = client.get("/api/export").json()
    response = preview_record(client, "template", template)
    assert response.status_code == 200, response.text
    plan = response.json()
    assert plan["counts"]["drafts"] == 0 and plan["counts"]["template_links"] == 1
    result = confirm(client, plan["plan_id"])
    assert result.status_code == 200, result.text
    after = client.get("/api/export").json()
    assert after["templates"] == []
    assert after["drafts"] == [{**before["drafts"][0], "template_id": None}]
    for table in ("campaigns", "prospects", "handoffs", "replies", "reminders", "suppressions"):
        assert after[table] == before[table]
    with closing(
        sqlite3.connect(privacy.settings.backup_path / result.json()["backup_file"])
    ) as connection:
        assert connection.execute("SELECT COUNT(*) FROM templates").fetchone()[0] == 1
    assert confirm(client, plan["plan_id"]).json()["replayed"] is True


@pytest.mark.parametrize("kind", ["campaign", "template"])
@pytest.mark.parametrize("mutation", ["root", "draft", "new_link", "foreign_link", "removed"])
def test_record_preview_changed_or_foreign_link_fails_before_backup(client, kind, mutation):
    setup_owner(client)
    campaign, prospect, template, draft = aged_conversation(client)
    record_id = campaign if kind == "campaign" else template
    plan = preview_record(client, kind, record_id).json()
    table = "campaigns" if kind == "campaign" else "templates"
    with db.transaction() as connection:
        if mutation == "root":
            connection.execute(f"UPDATE {table} SET name='Changed' WHERE id=?", (record_id,))
        elif mutation == "draft":
            connection.execute(
                "UPDATE drafts SET body='Changed after preview' WHERE id=?", (draft,)
            )
        elif mutation == "removed":
            connection.execute(f"DELETE FROM {table} WHERE id=?", (record_id,))
        elif mutation == "foreign_link":
            connection.execute(
                "INSERT INTO workspaces(name,created_at) VALUES ('Foreign',?)", (db.now(),)
            )
            connection.execute("UPDATE drafts SET workspace_id=2 WHERE id=?", (draft,))
        else:
            connection.execute(
                "INSERT INTO prospects(workspace_id,name,source_url,created_at,updated_at) "
                "VALUES (1,'Additional','https://simbi.com/fictional-additional',?,?)",
                (db.now(), db.now()),
            )
            extra_id = connection.execute("SELECT max(id) FROM prospects").fetchone()[0]
            connection.execute(
                "INSERT INTO drafts(workspace_id,campaign_id,prospect_id,template_id,body,quality_score,created_at,updated_at) "
                "VALUES (1,?,?,?,'New history',90,?,?)",
                (campaign, extra_id, template, db.now(), db.now()),
            )
    result = confirm(client, plan["plan_id"])
    assert result.status_code == 409, result.text
    assert result.json()["error"]["code"] == "privacy_preview_changed"
    assert not list(privacy.settings.backup_path.glob("*.db"))


@pytest.mark.parametrize("status", ["prepared", "opened", "ambiguous", "orphan"])
def test_campaign_protects_pending_or_uncertain_actions(client, status):
    setup_owner(client)
    campaign, _, _, draft = aged_conversation(client)
    with db.transaction() as connection:
        if status == "orphan":
            connection.execute("UPDATE drafts SET state='ambiguous' WHERE id=?", (draft,))
        else:
            connection.execute(
                "INSERT INTO handoffs(workspace_id,draft_id,idempotency_key,provider_url,content_hash,status,prepared_at) "
                "VALUES (1,?,'fictional-campaign','https://simbi.com/','hash',?,?)",
                (draft, status, db.now()),
            )
    result = preview_record(client, "campaign", campaign)
    assert result.status_code == 409 and result.json()["error"]["code"] == "privacy_in_flight"
    assert not db.fetch_one("SELECT id FROM privacy_cleanup_plans")


@pytest.mark.parametrize("kind", ["campaign", "template"])
def test_record_backup_failure_and_postbackup_failure_roll_back(client, kind, monkeypatch):
    setup_owner(client)
    campaign, _, template, _ = aged_conversation(client)
    record_id = campaign if kind == "campaign" else template
    plan = preview_record(client, kind, record_id).json()["plan_id"]
    original = db._snapshot

    def fail(*args):
        raise OSError("fictional backup failure")

    monkeypatch.setattr(db, "_snapshot", fail)
    assert confirm(client, plan).status_code == 503
    monkeypatch.setattr(db, "_snapshot", original)
    table = "campaigns" if kind == "campaign" else "templates"
    with db.transaction() as connection:
        connection.execute(
            f"CREATE TRIGGER fictional_delete_failure BEFORE DELETE ON {table} BEGIN SELECT RAISE(ABORT,'fixture'); END"
        )
    assert confirm(client, plan).status_code == 409
    assert db.fetch_one(f"SELECT id FROM {table} WHERE id=?", (record_id,))
    assert not db.fetch_one("SELECT id FROM suppressions")
    assert db.fetch_one("SELECT receipt_json FROM privacy_cleanup_plans")["receipt_json"] is None


@pytest.mark.parametrize("kind", ["campaign", "template"])
def test_record_owner_selection_limits_and_missing_targets(client, kind, monkeypatch):
    setup_owner(client)
    campaign, _, template, _ = aged_conversation(client)
    selected = campaign if kind == "campaign" else template
    assert preview_record(client, kind, 9999).status_code == 404
    for payload in (
        {"kind": kind},
        {"kind": kind, f"{kind}_id": selected, "prospect_id": 1},
        {"kind": "retention", f"{kind}_id": selected},
    ):
        assert (
            client.post(
                "/api/privacy/preview", headers=csrf_headers(client), json=payload
            ).status_code
            == 422
        )
    monkeypatch.setattr(privacy, "SCAN_LIMIT", 0)
    assert preview_record(client, kind, selected).status_code == 409
    monkeypatch.setattr(privacy, "SCAN_LIMIT", 1000)
    plan = preview_record(client, kind, selected).json()["plan_id"]
    with db.transaction() as connection:
        connection.execute("UPDATE memberships SET role='admin'")
    assert preview_record(client, kind, selected).status_code == 403
    assert confirm(client, plan).status_code == 403


@pytest.mark.parametrize("kind", ["campaign", "template"])
def test_empty_container_removal_and_foreign_root_protection(client, kind):
    setup_owner(client)
    campaign, _, template = create_foundation(client)
    record_id = campaign if kind == "campaign" else template
    with db.transaction() as connection:
        connection.execute(
            "INSERT INTO workspaces(name,created_at) VALUES ('Other',?)", (db.now(),)
        )
        if kind == "campaign":
            foreign = connection.execute(
                "INSERT INTO campaigns(workspace_id,name,purpose,lawful_basis,created_at,updated_at) VALUES (2,'Foreign','Foreign purpose','Reviewed context',?,?)",
                (db.now(), db.now()),
            ).lastrowid
        else:
            foreign = connection.execute(
                "INSERT INTO templates(workspace_id,name,body,created_at,updated_at) VALUES (2,'Foreign','Foreign template content',?,?)",
                (db.now(), db.now()),
            ).lastrowid
    assert preview_record(client, kind, foreign).status_code == 404
    plan = preview_record(client, kind, record_id).json()
    assert plan["counts"]["drafts"] == 0
    assert confirm(client, plan["plan_id"]).status_code == 200
    table = "campaigns" if kind == "campaign" else "templates"
    assert db.fetch_one(f"SELECT id FROM {table} WHERE id=?", (foreign,))
    assert not db.fetch_one("SELECT id FROM suppressions")


def test_campaign_removal_protects_pending_actions_in_other_campaign(client):
    setup_owner(client)
    campaign, prospect, _, _ = aged_conversation(client)
    with db.transaction() as connection:
        other_campaign = connection.execute(
            "INSERT INTO campaigns(workspace_id,name,purpose,lawful_basis,created_at,updated_at) VALUES (1,'Other pending','Other purpose','Reviewed context',?,?)",
            (db.now(), db.now()),
        ).lastrowid
        connection.execute(
            "INSERT INTO drafts(workspace_id,campaign_id,prospect_id,body,state,quality_score,created_at,updated_at) VALUES (1,?,?,'Other unresolved history','handoff_created',90,?,?)",
            (other_campaign, prospect, db.now(), db.now()),
        )
    result = preview_record(client, "campaign", campaign)
    assert result.status_code == 409 and result.json()["error"]["code"] == "privacy_in_flight"
