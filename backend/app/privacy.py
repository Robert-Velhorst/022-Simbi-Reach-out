"""Explicit local cleanup, never an automatic worker or provider operation."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from contextlib import closing
from datetime import UTC, datetime, timedelta

from . import db
from .config import settings
from .security import validate_provider_url

BATCH_SIZE = 50
SCAN_LIMIT = 1000


class PrivacyError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def encoded(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def graph(connection, workspace_id: int, prospect_id: int) -> dict:
    prospect = connection.execute(
        "SELECT * FROM prospects WHERE id=? AND workspace_id=?", (prospect_id, workspace_id)
    ).fetchone()
    if not prospect:
        raise PrivacyError(404, "not_found", "The requested record was not found")
    try:
        validate_provider_url(prospect["source_url"])
    except ValueError as exc:
        raise PrivacyError(
            409,
            "privacy_inconsistent",
            "Cleanup found inconsistent record links; reconcile the database first",
        ) from exc
    if connection.execute(
        "SELECT 1 FROM suppressions WHERE prospect_id=? AND workspace_id<>?",
        (prospect_id, workspace_id),
    ).fetchone():
        raise PrivacyError(
            409,
            "privacy_inconsistent",
            "Cleanup found inconsistent record links; reconcile the database first",
        )
    rows = {"prospects": [dict(prospect)]}
    queries = {
        "drafts": "prospect_id=?",
        "handoffs": "draft_id IN (SELECT id FROM drafts WHERE prospect_id=?)",
        "replies": "draft_id IN (SELECT id FROM drafts WHERE prospect_id=?)",
        "reminders": "prospect_id=? OR draft_id IN (SELECT id FROM drafts WHERE prospect_id=?)",
    }
    for table, condition in queries.items():
        parameters = (prospect_id, prospect_id) if table == "reminders" else (prospect_id,)
        rows[table] = [
            dict(row)
            for row in connection.execute(
                f"SELECT * FROM {table} WHERE {condition} ORDER BY id", parameters
            )
        ]
        # Foreign keys alone do not enforce a workspace boundary. Fail closed on
        # historical inconsistent links rather than cascade-delete foreign data.
        if any(row["workspace_id"] != workspace_id for row in rows[table]):
            raise PrivacyError(
                409,
                "privacy_inconsistent",
                "Cleanup found inconsistent record links; reconcile the database first",
            )
    if any(row["prospect_id"] not in {None, prospect_id} for row in rows["reminders"]):
        raise PrivacyError(
            409,
            "privacy_inconsistent",
            "Cleanup found inconsistent record links; reconcile the database first",
        )
    rows["campaigns"] = [
        dict(row)
        for row in connection.execute(
            "SELECT * FROM campaigns WHERE id IN (SELECT campaign_id FROM drafts WHERE prospect_id=?) ORDER BY id",
            (prospect_id,),
        )
    ]
    if any(row["workspace_id"] != workspace_id for row in rows["campaigns"]):
        raise PrivacyError(
            409,
            "privacy_inconsistent",
            "Cleanup found inconsistent record links; reconcile the database first",
        )
    rows["suppressions"] = [
        dict(row)
        for row in connection.execute(
            "SELECT * FROM suppressions WHERE workspace_id=? ORDER BY id", (workspace_id,)
        )
    ]
    # Recent reminder completions have no updated_at column; include the audit
    # events for this graph when calculating age and detecting stale previews.
    rows["audit_events"] = []
    for table, entity in (
        ("prospects", "prospect"),
        ("drafts", "draft"),
        ("handoffs", "handoff"),
        ("reminders", "reminder"),
    ):
        ids = [str(row["id"]) for row in rows[table]]
        if ids:
            placeholders = ",".join("?" for _ in ids)
            rows["audit_events"].extend(
                dict(row)
                for row in connection.execute(
                    f"SELECT * FROM audit_events WHERE workspace_id=? AND entity_type=? AND entity_id IN ({placeholders}) ORDER BY id",
                    (workspace_id, entity, *ids),
                )
            )
    return rows


def in_flight(rows: dict) -> bool:
    return any(
        row["status"] in {"prepared", "opened", "ambiguous"} for row in rows["handoffs"]
    ) or any(row["state"] in {"ambiguous", "handoff_created"} for row in rows["drafts"])


def old_and_closed(rows: dict, cutoff: str) -> bool:
    if in_flight(rows) or any(row["status"] == "open" for row in rows["reminders"]):
        return False
    if any(row["status"] != "archived" for row in rows["campaigns"]):
        return False
    for table in (
        "prospects",
        "drafts",
        "handoffs",
        "replies",
        "reminders",
        "campaigns",
        "audit_events",
    ):
        for row in rows[table]:
            for column in (
                "created_at",
                "updated_at",
                "approved_at",
                "sent_at",
                "prepared_at",
                "completed_at",
                "received_at",
                "due_at",
            ):
                value = row.get(column)
                if value:
                    try:
                        date = datetime.fromisoformat(value)
                        if date.tzinfo is None or date >= datetime.fromisoformat(cutoff):
                            return False
                    except ValueError:
                        return False
    return True


def snapshot(connection, workspace_id: int, ids: list[int]) -> tuple[str, dict, list[dict]]:
    rows = [graph(connection, workspace_id, record_id) for record_id in ids]
    counts = {
        table: sum(len(item[table]) for item in rows)
        for table in ("prospects", "drafts", "handoffs", "replies", "reminders")
    }
    digest = hashlib.sha256(encoded(rows).encode()).hexdigest()
    contacts = [
        {"id": item["prospects"][0]["id"], "name": item["prospects"][0]["name"]} for item in rows
    ]
    return digest, counts, contacts


def preview(connection, member: dict, kind: str, prospect_id: int | None) -> dict:
    workspace_id = member["workspace_id"]
    days = connection.execute(
        "SELECT retention_days FROM workspaces WHERE id=?", (workspace_id,)
    ).fetchone()[0]
    cutoff = (datetime.now(UTC) - timedelta(days=days)).replace(microsecond=0).isoformat()
    protected = 0
    if kind == "prospect":
        rows = graph(connection, workspace_id, prospect_id)
        if in_flight(rows):
            raise PrivacyError(
                409,
                "privacy_in_flight",
                "Resolve pending or uncertain handoffs before deleting this contact",
            )
        ids, remaining = [prospect_id], 0
    else:
        candidates = connection.execute(
            "SELECT id FROM prospects WHERE workspace_id=? AND updated_at<? ORDER BY id LIMIT ?",
            (workspace_id, cutoff, SCAN_LIMIT + 1),
        ).fetchall()
        if len(candidates) > SCAN_LIMIT:
            raise PrivacyError(
                409,
                "privacy_scan_limit",
                "Too many old contacts for one cleanup scan; export and remove selected contacts instead",
            )
        eligible = []
        for candidate in candidates:
            if old_and_closed(graph(connection, workspace_id, candidate["id"]), cutoff):
                eligible.append(candidate["id"])
            else:
                protected += 1
        ids, remaining = eligible[:BATCH_SIZE], max(0, len(eligible) - BATCH_SIZE)
    digest, counts, contacts = snapshot(connection, workspace_id, ids)
    timestamp = db.now()
    expires = (datetime.now(UTC) + timedelta(minutes=10)).replace(microsecond=0).isoformat()
    plan_id = uuid.uuid4().hex
    plan = {
        "kind": kind,
        "ids": ids,
        "digest": digest,
        "counts": counts,
        "cutoff": cutoff,
        "retention_days": days,
    }
    # A new preview invalidates this owner's older pending previews, including
    # those held in another tab. Completed receipts remain retryable.
    connection.execute(
        "DELETE FROM privacy_cleanup_plans WHERE workspace_id=? AND owner_id=? AND receipt_json IS NULL",
        (workspace_id, member["user_id"]),
    )
    connection.execute(
        "INSERT INTO privacy_cleanup_plans(id,workspace_id,owner_id,plan_json,created_at,expires_at) VALUES (?,?,?,?,?,?)",
        (plan_id, workspace_id, member["user_id"], encoded(plan), timestamp, expires),
    )
    db.audit(
        connection,
        workspace_id,
        member["user_id"],
        "privacy.cleanup_previewed",
        "privacy",
        plan_id,
        {"kind": kind, "counts": counts},
    )
    return {
        "plan_id": plan_id,
        "expires_at": expires,
        "cutoff": cutoff,
        "retention_days": days,
        "counts": counts,
        "contacts": contacts,
        "protected_contacts": protected,
        "remaining_eligible_contacts": remaining,
    }


def execute(connection, member: dict, plan_id: str) -> dict:
    workspace_id = member["workspace_id"]
    record = connection.execute(
        "SELECT * FROM privacy_cleanup_plans WHERE id=? AND workspace_id=? AND owner_id=?",
        (plan_id, workspace_id, member["user_id"]),
    ).fetchone()
    if not record:
        raise PrivacyError(
            409, "privacy_preview_required", "Create a new cleanup preview before confirming"
        )
    if record["receipt_json"]:
        return {**json.loads(record["receipt_json"]), "replayed": True}
    if record["expires_at"] <= db.now():
        raise PrivacyError(
            409, "privacy_preview_expired", "The cleanup preview expired; create a new preview"
        )
    plan = json.loads(record["plan_json"])
    if not plan["ids"]:
        raise PrivacyError(409, "privacy_empty", "This preview contains no contacts to remove")
    days = connection.execute(
        "SELECT retention_days FROM workspaces WHERE id=?", (workspace_id,)
    ).fetchone()[0]
    try:
        digest, counts, _ = snapshot(connection, workspace_id, plan["ids"])
    except PrivacyError as exc:
        raise PrivacyError(
            409,
            "privacy_preview_changed",
            "Records changed after the preview; create a new preview",
        ) from exc
    if days != plan["retention_days"] or digest != plan["digest"]:
        raise PrivacyError(
            409,
            "privacy_preview_changed",
            "Records changed after the preview; create a new preview",
        )
    for record_id in plan["ids"]:
        rows = graph(connection, workspace_id, record_id)
        if in_flight(rows) or (
            plan["kind"] == "retention" and not old_and_closed(rows, plan["cutoff"])
        ):
            raise PrivacyError(
                409,
                "privacy_preview_changed",
                "Records changed after the preview; create a new preview",
            )
    # BEGIN IMMEDIATE is already held, and no writes have happened in this
    # transaction. A separate reader copies the committed pre-cleanup database;
    # backing up the active writer itself can block. Do not call migrate here.
    try:
        with closing(db.connect()) as reader:
            backup = db._snapshot(reader, settings.backup_path)
    except (OSError, sqlite3.Error, RuntimeError) as exc:
        raise PrivacyError(
            503,
            "privacy_backup_failed",
            "Recovery backup could not be verified; no cleanup was performed",
        ) from exc
    for record_id in plan["ids"]:
        prospect = connection.execute(
            "SELECT * FROM prospects WHERE id=? AND workspace_id=?", (record_id, workspace_id)
        ).fetchone()
        key = f"{prospect['provider']}:{validate_provider_url(prospect['source_url'])}".lower()
        connection.execute(
            "INSERT OR IGNORE INTO suppressions(workspace_id,prospect_id,normalized_value,reason,created_by,created_at) VALUES (?,?,?,?,?,?)",
            (
                workspace_id,
                record_id,
                key,
                "Local history removed; do not contact",
                member["user_id"],
                db.now(),
            ),
        )
        connection.execute(
            "DELETE FROM prospects WHERE id=? AND workspace_id=?", (record_id, workspace_id)
        )
    receipt = {
        "plan_id": plan_id,
        "counts": counts,
        "backup_file": backup.name,
        "completed_at": db.now(),
        "replayed": False,
    }
    connection.execute(
        "UPDATE privacy_cleanup_plans SET receipt_json=? WHERE id=?", (encoded(receipt), plan_id)
    )
    db.audit(
        connection,
        workspace_id,
        member["user_id"],
        "privacy.cleanup_completed",
        "privacy",
        plan_id,
        {"counts": counts, "backup_file": backup.name},
    )
    return receipt
