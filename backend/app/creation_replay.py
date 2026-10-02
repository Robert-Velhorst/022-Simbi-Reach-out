"""Local creation confirmation recovery, never a provider sending capability."""

import hashlib
import hmac
import json

from . import db
from .domain import parse_flags
from .reminder_replay import KEY_PATTERN, ReplayError, fingerprint

RECEIPT_LIMIT = 10_000  # No expiry/pruning: old references must not become new writes.
# Fixed internal identifiers only; no caller-supplied SQL identifier.
TARGETS = {
    "campaigns": ("campaigns", "campaign_id"),
    "prospects": ("prospects", "prospect_id"),
    "templates": ("templates", "template_id"),
    "drafts": ("drafts", "draft_id"),
    "replies": ("replies", "reply_id"),
    "prospects/import": ("audit_events", "audit_id"),
}


def validate_key(values: list[str] | None) -> str | None:
    if values is None:
        return None  # Legacy unkeyed callers are compatible, not replay protected.
    if len(values) != 1 or KEY_PATTERN.fullmatch(values[0]) is None:
        raise ReplayError(
            400,
            "creation_key_invalid",
            "Provide one opaque Idempotency-Key using 16 to 120 ASCII letters, digits, underscores or hyphens",
        )
    return values[0]


def confirmation(operation: str, row: dict) -> dict:
    if operation == "drafts":
        return {
            **{
                field: row[field]
                for field in (
                    "id",
                    "campaign_id",
                    "prospect_id",
                    "template_id",
                    "state",
                    "quality_score",
                )
            },
            "safety_flags": parse_flags(row["safety_flags"]),
        }
    if operation == "replies":
        return {
            **{field: row[field] for field in ("id", "draft_id", "body", "received_at")},
            "state": "replied",
        }
    if operation == "prospects/import":
        # Import history already stores non-private counts, not a response copy.
        counts = json.loads(row["details"])
        inserted, duplicates = counts["inserted"], counts["duplicates"]
        if (
            row["event_type"] != "prospect.imported"
            or row["entity_type"] != "prospect"
            or row["entity_id"] != "bulk"
            or type(inserted) is not int
            or type(duplicates) is not int
            or inserted < 0
            or duplicates < 0
            or inserted + duplicates > 5000
        ):
            raise ReplayError(
                409, "creation_receipt_unavailable", "Check the original import history"
            )
        return {
            "valid": inserted + duplicates,
            "errors": [],
            "inserted": inserted,
            "duplicates": duplicates,
            "committed": True,
        }
    return row


def lookup(connection, member: dict, key: str, operation: str, body: dict) -> dict | None:
    receipt = connection.execute(
        "SELECT * FROM core_creation_receipts WHERE workspace_id=? AND actor_user_id=? AND key_hash=?",
        (member["workspace_id"], member["user_id"], hashlib.sha256(key.encode()).hexdigest()),
    ).fetchone()
    if receipt is not None:
        if receipt["operation"] != operation or not hmac.compare_digest(
            receipt["request_hash"], fingerprint(key, body)
        ):
            raise ReplayError(
                409,
                "creation_key_conflict",
                "This retry reference belongs to different submitted values or a different creation. Check the saved records or retry the original values; nothing new was created.",
            )
        table, column = TARGETS[operation]
        row = connection.execute(
            f"SELECT * FROM {table} WHERE id=? AND workspace_id=?",
            (receipt[column], member["workspace_id"]),
        ).fetchone()
        if row is None or not hmac.compare_digest(
            receipt["result_hash"], fingerprint(key, dict(row))
        ):
            raise ReplayError(
                409,
                "creation_receipt_unavailable",
                "The original record or import history was removed or changed. Check the saved records; this retry did not recreate anything.",
            )
        return {**confirmation(operation, dict(row)), "creation_key": key, "replayed": True}
    count = connection.execute(
        "SELECT COUNT(*) FROM core_creation_receipts WHERE workspace_id=? AND actor_user_id=?",
        (member["workspace_id"], member["user_id"]),
    ).fetchone()[0]
    if count >= RECEIPT_LIMIT:
        raise ReplayError(
            409,
            "creation_receipt_limit",
            "The creation retry-reference limit was reached. Existing references still work; nothing new was created.",
        )
    return None


def remember(connection, member: dict, key: str, operation: str, body: dict, row: dict) -> dict:
    _, column = TARGETS[operation]
    connection.execute(
        f"INSERT INTO core_creation_receipts(workspace_id,actor_user_id,key_hash,operation,"
        f"request_hash,result_hash,{column},created_at) VALUES (?,?,?,?,?,?,?,?)",
        (
            member["workspace_id"],
            member["user_id"],
            hashlib.sha256(key.encode()).hexdigest(),
            operation,
            fingerprint(key, body),
            fingerprint(key, row),
            row["id"],
            db.now(),
        ),
    )
    return {**confirmation(operation, row), "creation_key": key, "replayed": False}
