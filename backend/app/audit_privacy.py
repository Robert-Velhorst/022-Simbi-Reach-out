"""Owner-confirmed minimization of known legacy duplicate audit fields only."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from contextlib import closing
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from . import db, privacy
from .domain import APPROVAL_CHECKS

KIND = "audit_redaction"
EVENTS = ("prospect.suppressed", "provider.updated", "draft.approved", "draft.declined")
MAX_DETAIL_DEPTH = 64


def _within_depth(value) -> bool:
    # Iterative and explicit: test runners may raise Python's recursion limit.
    stack = [(value, 1)]
    while stack:
        item, depth = stack.pop()
        if isinstance(item, dict | list):
            if depth > MAX_DETAIL_DEPTH:
                return False
            values = item.values() if isinstance(item, dict) else item
            stack.extend((child, depth + 1) for child in values)
    return True


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Ambiguous duplicate JSON keys")
        result[key] = value
    return result


def _invalid_constant(_value):
    raise ValueError("Nonstandard JSON value")


def _exact_float(value: str) -> float:
    number = float(value)
    # Canonical JSON encoding must not round unknown evidence or emit Infinity.
    if Decimal(str(number)) != Decimal(value):
        raise ValueError("Legacy JSON number cannot be preserved exactly")
    return number


def minimized(row: dict, cutoff: str) -> tuple[dict | None, list[str], bool]:
    """Return replacement, field names and protection flag; never expose old text."""
    try:
        date = datetime.fromisoformat(row["created_at"])
        if date.tzinfo is None or date >= datetime.fromisoformat(cutoff):
            return None, [], True
        details = json.loads(
            row["details"],
            object_pairs_hook=_unique_object,
            parse_constant=_invalid_constant,
            parse_float=_exact_float,
        )
        if not isinstance(details, dict) or not _within_depth(details):
            return None, [], True
        fields = []
        key = {"prospect.suppressed": "reason", "provider.updated": "base_url"}.get(
            row["event_type"]
        )
        if key and key in details:
            if not isinstance(details[key], str):
                return None, [], True
            del details[key]
            fields.append(key)
        elif row["event_type"] in {"draft.approved", "draft.declined"} and "checks" in details:
            checks = details["checks"]
            if not isinstance(checks, list) or any(not isinstance(item, str) for item in checks):
                return None, [], True
            if any(item not in APPROVAL_CHECKS for item in checks):
                # Keep recognized evidence, including its original ordering/duplicates.
                details["checks"] = [item for item in checks if item in APPROVAL_CHECKS]
                fields.append("checks")
        return (details if fields else None), fields, False
    except (ValueError, TypeError, OverflowError, RecursionError):
        return None, [], True


def snapshot(connection, workspace_id: int, ids: list[int], cutoff: str):
    rows, replacements = [], []
    for event_id in ids:
        record = connection.execute(
            "SELECT * FROM audit_events WHERE id=? AND workspace_id=?", (event_id, workspace_id)
        ).fetchone()
        if not record or record["event_type"] not in EVENTS:
            raise privacy.PrivacyError(
                409,
                "privacy_preview_changed",
                "Records changed after the preview; create a new preview",
            )
        row = dict(record)
        details, fields, protected = minimized(row, cutoff)
        if protected or details is None:
            raise privacy.PrivacyError(
                409,
                "privacy_preview_changed",
                "Records changed after the preview; create a new preview",
            )
        rows.append(row)
        replacements.append((event_id, details, fields))
    digest = hashlib.sha256(privacy.encoded(rows).encode()).hexdigest()
    return digest, replacements


def preview(connection, member: dict, after_id: int = 0) -> dict:
    workspace_id = member["workspace_id"]
    days = connection.execute(
        "SELECT retention_days FROM workspaces WHERE id=?", (workspace_id,)
    ).fetchone()[0]
    cutoff = (datetime.now(UTC) - timedelta(days=days)).replace(microsecond=0).isoformat()
    placeholders = ",".join("?" for _ in EVENTS)
    page = connection.execute(
        f"SELECT * FROM audit_events WHERE workspace_id=? AND id>? AND event_type IN ({placeholders}) ORDER BY id LIMIT ?",
        (workspace_id, after_id, *EVENTS, privacy.SCAN_LIMIT + 1),
    ).fetchall()
    scanned = page[: privacy.SCAN_LIMIT]
    eligible, protected, unchanged, events = [], 0, 0, []
    for record in scanned:
        details, fields, keep = minimized(dict(record), cutoff)
        if keep:
            protected += 1
        elif details is None:
            unchanged += 1
        else:
            eligible.append(record["id"])
            if len(events) < privacy.BATCH_SIZE:
                events.append(
                    {
                        "id": record["id"],
                        "event_type": record["event_type"],
                        "entity_type": record["entity_type"],
                        "entity_id": record["entity_id"],
                        "created_at": record["created_at"],
                        "fields": fields,
                    }
                )
    ids = eligible[: privacy.BATCH_SIZE]
    digest, _ = snapshot(connection, workspace_id, ids, cutoff)
    counts = {"audit_events": len(ids)}
    plan_id = uuid.uuid4().hex
    expires = (datetime.now(UTC) + timedelta(minutes=10)).replace(microsecond=0).isoformat()
    plan = {
        "kind": KIND,
        "ids": ids,
        "digest": digest,
        "counts": counts,
        "cutoff": cutoff,
        "retention_days": days,
    }
    connection.execute(
        "DELETE FROM privacy_cleanup_plans WHERE workspace_id=? AND owner_id=? AND receipt_json IS NULL",
        (workspace_id, member["user_id"]),
    )
    connection.execute(
        "INSERT INTO privacy_cleanup_plans(id,workspace_id,owner_id,plan_json,created_at,expires_at) VALUES (?,?,?,?,?,?)",
        (plan_id, workspace_id, member["user_id"], privacy.encoded(plan), db.now(), expires),
    )
    db.audit(
        connection,
        workspace_id,
        member["user_id"],
        "privacy.audit_previewed",
        "privacy",
        plan_id,
        {"counts": counts},
    )
    return {
        "kind": KIND,
        "plan_id": plan_id,
        "expires_at": expires,
        "cutoff": cutoff,
        "retention_days": days,
        "counts": counts,
        "events": events,
        "after_id": after_id,
        "scanned_events": len(scanned),
        "protected_events": protected,
        "unchanged_events": unchanged,
        "remaining_eligible_events": len(eligible) - len(ids),
        "has_more_events": len(page) > privacy.SCAN_LIMIT,
        "next_after_id": scanned[-1]["id"] if len(page) > privacy.SCAN_LIMIT else None,
    }


def execute(connection, member: dict, plan_id: str) -> dict:
    workspace_id = member["workspace_id"]
    record = connection.execute(
        "SELECT * FROM privacy_cleanup_plans WHERE id=? AND workspace_id=? AND owner_id=?",
        (plan_id, workspace_id, member["user_id"]),
    ).fetchone()
    if not record:
        raise privacy.PrivacyError(
            409, "privacy_preview_required", "Create a new cleanup preview before confirming"
        )
    plan = json.loads(record["plan_json"])
    if plan["kind"] != KIND:
        raise privacy.PrivacyError(
            409, "audit_confirmation_required", "Use the separate audit minimization confirmation"
        )
    if record["receipt_json"]:
        return {**json.loads(record["receipt_json"]), "replayed": True}
    if record["expires_at"] <= db.now():
        raise privacy.PrivacyError(
            409, "privacy_preview_expired", "The cleanup preview expired; create a new preview"
        )
    if not plan["ids"]:
        raise privacy.PrivacyError(
            409, "privacy_empty", "This preview contains no audit fields to minimize"
        )
    days = connection.execute(
        "SELECT retention_days FROM workspaces WHERE id=?", (workspace_id,)
    ).fetchone()[0]
    digest, replacements = snapshot(connection, workspace_id, plan["ids"], plan["cutoff"])
    if days != plan["retention_days"] or digest != plan["digest"]:
        raise privacy.PrivacyError(
            409,
            "privacy_preview_changed",
            "Records changed after the preview; create a new preview",
        )
    # The reserved writer has made no writes; copy committed pre-change data.
    try:
        with closing(db.connect()) as reader:
            backup = db._snapshot(reader, privacy.settings.backup_path)
    except (OSError, sqlite3.Error, RuntimeError) as exc:
        raise privacy.PrivacyError(
            503,
            "privacy_backup_failed",
            "Recovery backup could not be verified; no cleanup was performed",
        ) from exc
    for event_id, details, _fields in replacements:
        connection.execute(
            "UPDATE audit_events SET details=? WHERE id=? AND workspace_id=?",
            (privacy.encoded(details), event_id, workspace_id),
        )
    receipt = {
        "kind": KIND,
        "plan_id": plan_id,
        "counts": plan["counts"],
        "backup_file": backup.name,
        "completed_at": db.now(),
        "replayed": False,
    }
    connection.execute(
        "UPDATE privacy_cleanup_plans SET receipt_json=? WHERE id=?",
        (privacy.encoded(receipt), plan_id),
    )
    db.audit(
        connection,
        workspace_id,
        member["user_id"],
        "privacy.audit_minimized",
        "privacy",
        plan_id,
        {"counts": plan["counts"], "backup_file": backup.name},
    )
    return receipt
