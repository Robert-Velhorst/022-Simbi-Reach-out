"""Owner-operated retirement of a single-account installation, never provider deletion."""

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
import uuid
from contextlib import closing
from datetime import UTC, datetime, timedelta

from . import db, privacy
from .privacy import PrivacyError, encoded

# Internal schema allowlist, not caller-provided SQL identifiers. New tables
# require an explicit retirement decision before this workflow can run again.
TABLES = (
    "users",
    "workspaces",
    "memberships",
    "sessions",
    "campaigns",
    "prospects",
    "templates",
    "drafts",
    "handoffs",
    "replies",
    "reminders",
    "suppressions",
    "provider_settings",
    "feature_flags",
    "audit_events",
    "analytics_events",
    "login_attempts",
    "privacy_cleanup_plans",
    "reminder_creation_receipts",
)
ROW_LIMIT = 100_000


def is_retired(connection) -> bool:
    return connection.execute("SELECT 1 FROM installation_retirement").fetchone() is not None


def eligibility(connection, member: dict):
    if is_retired(connection):
        raise PrivacyError(409, "installation_retired", "This local installation is retired")
    try:
        db._validate_schema(connection)
    except (ValueError, sqlite3.Error) as exc:
        raise PrivacyError(
            409, "retirement_schema_unknown", "Reconcile the database schema before retirement"
        ) from exc
    tables = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    if tables != set(TABLES) | {
        "schema_migrations",
        "maintenance_state",
        "installation_retirement",
    }:
        raise PrivacyError(
            409, "retirement_schema_unknown", "Reconcile the database schema before retirement"
        )
    if connection.execute("PRAGMA foreign_key_check").fetchone():
        raise PrivacyError(
            409, "privacy_inconsistent", "Reconcile inconsistent database links before retirement"
        )
    users = connection.execute("SELECT id,display_name FROM users ORDER BY id LIMIT 2").fetchall()
    workspaces = connection.execute(
        "SELECT id,name,paused_at FROM workspaces ORDER BY id LIMIT 2"
    ).fetchall()
    memberships = connection.execute("SELECT * FROM memberships LIMIT 2").fetchall()
    if (
        len(users) != 1
        or len(workspaces) != 1
        or len(memberships) != 1
        or users[0]["id"] != member["user_id"]
        or workspaces[0]["id"] != member["workspace_id"]
        or memberships[0]["user_id"] != member["user_id"]
        or memberships[0]["workspace_id"] != member["workspace_id"]
        or memberships[0]["role"] != "owner"
    ):
        raise PrivacyError(
            409,
            "retirement_personal_only",
            "Retirement requires exactly one local owner and one workspace; shared installations are protected",
        )
    if not workspaces[0]["paused_at"]:
        raise PrivacyError(
            409, "retirement_pause_required", "Enable the safety stop before previewing retirement"
        )
    if (
        connection.execute(
            "SELECT 1 FROM handoffs WHERE status IN ('prepared','opened','ambiguous') LIMIT 1"
        ).fetchone()
        or connection.execute(
            "SELECT 1 FROM drafts WHERE state IN ('handoff_created','ambiguous') LIMIT 1"
        ).fetchone()
    ):
        raise PrivacyError(
            409, "privacy_in_flight", "Resolve pending or uncertain handoffs before retirement"
        )
    return {"owner_name": users[0]["display_name"], "workspace_name": workspaces[0]["name"]}


def snapshot(connection, plan_id: str):
    digest = hashlib.sha256()
    counts = {}
    for table in TABLES:
        condition = " WHERE id<>?" if table == "privacy_cleanup_plans" else ""
        parameters = (plan_id,) if condition else ()
        count = connection.execute(
            f"SELECT COUNT(*) FROM {table}{condition}", parameters
        ).fetchone()[0]
        counts[table] = count
        if sum(counts.values()) > ROW_LIMIT:
            raise PrivacyError(
                409,
                "retirement_scan_limit",
                "Too many records for one verified retirement; use operator-assisted recovery",
            )
        digest.update(encoded([table, count]).encode())
        for row in connection.execute(
            f"SELECT * FROM {table}{condition} ORDER BY rowid", parameters
        ):
            digest.update(encoded(dict(row)).encode())
            digest.update(b"\n")
    # The preview's own plan is also deleted but cannot hash its own digest.
    counts["privacy_cleanup_plans"] += 1
    return digest.hexdigest(), counts


def preview(connection, member: dict):
    identity = eligibility(connection, member)
    connection.execute("DELETE FROM privacy_cleanup_plans WHERE receipt_json IS NULL")
    plan_id = uuid.uuid4().hex
    expires = (datetime.now(UTC) + timedelta(minutes=10)).replace(microsecond=0).isoformat()
    db.audit(
        connection,
        member["workspace_id"],
        member["user_id"],
        "privacy.retirement_previewed",
        "privacy",
        plan_id,
        {"kind": "retirement"},
    )
    digest, counts = snapshot(connection, plan_id)
    connection.execute(
        "INSERT INTO privacy_cleanup_plans(id,workspace_id,owner_id,plan_json,created_at,expires_at) VALUES (?,?,?,?,?,?)",
        (
            plan_id,
            member["workspace_id"],
            member["user_id"],
            encoded({"kind": "retirement", "digest": digest, "counts": counts}),
            db.now(),
            expires,
        ),
    )
    return {
        "kind": "retirement",
        "plan_id": plan_id,
        "expires_at": expires,
        "counts": counts,
        **identity,
    }


def execute(connection, member: dict, plan_id: str):
    eligibility(connection, member)
    record = connection.execute(
        "SELECT * FROM privacy_cleanup_plans WHERE id=? AND owner_id=? AND workspace_id=?",
        (plan_id, member["user_id"], member["workspace_id"]),
    ).fetchone()
    if not record:
        raise PrivacyError(
            409, "privacy_preview_required", "Create a new retirement preview before confirming"
        )
    if record["expires_at"] <= db.now():
        raise PrivacyError(
            409, "privacy_preview_expired", "The preview expired; create a new preview"
        )
    plan = json.loads(record["plan_json"])
    if plan["kind"] != "retirement":
        raise PrivacyError(
            409, "privacy_preview_required", "Create a retirement preview before confirming"
        )
    digest, counts = snapshot(connection, plan_id)
    if digest != plan["digest"] or counts != plan["counts"]:
        raise PrivacyError(
            409,
            "privacy_preview_changed",
            "Records changed after the preview; create a new preview",
        )
    # Writer reservation is held, with NO uncommitted writes before the reader
    # backup. Never back up this active writer or migrate inside this transaction.
    try:
        with closing(db.connect()) as reader:
            backup = db._snapshot(reader, privacy.settings.backup_path)
    except (OSError, sqlite3.Error, RuntimeError) as exc:
        raise PrivacyError(
            503,
            "privacy_backup_failed",
            "Recovery backup could not be verified; no retirement was performed",
        ) from exc
    connection.execute("DELETE FROM workspaces WHERE id=?", (member["workspace_id"],))
    connection.execute("DELETE FROM users WHERE id=?", (member["user_id"],))
    connection.execute("DELETE FROM login_attempts")
    if any(connection.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone() for table in TABLES):
        raise PrivacyError(
            409,
            "privacy_inconsistent",
            "Retirement left unexpected records; all database changes were rolled back",
        )
    receipt = {
        "kind": "retirement",
        "plan_id": plan_id,
        "counts": counts,
        "backup_file": backup.name,
        "completed_at": db.now(),
        "replayed": False,
    }
    connection.execute(
        "INSERT INTO installation_retirement(singleton,receipt_json) VALUES (1,?)",
        (encoded(receipt),),
    )
    return receipt


def completed_receipt(connection, plan_id: str):
    # Capability-only read: this unguessable preview token grants no write/login.
    row = connection.execute("SELECT receipt_json FROM installation_retirement").fetchone()
    if row:
        receipt = json.loads(row[0])
        if hmac.compare_digest(receipt["plan_id"], plan_id):
            return {**receipt, "replayed": True}
    raise PrivacyError(404, "not_found", "The requested receipt was not found")
