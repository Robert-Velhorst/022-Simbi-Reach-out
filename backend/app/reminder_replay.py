"""Atomic, content-minimized reminder creation receipts, not provider send receipts."""

import hashlib
import hmac
import json
import re

from . import db

RECEIPT_LIMIT = 10_000  # Refuse new keyed creations; never silently expire retry keys.
KEY_PATTERN = re.compile(r"[A-Za-z0-9_-]{16,120}", re.ASCII)


class ReplayError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def validate_key(values: list[str] | None) -> str | None:
    if values is None:
        return None  # Existing API callers remain compatible, but are not replay protected.
    if len(values) != 1 or KEY_PATTERN.fullmatch(values[0]) is None:
        raise ReplayError(
            400,
            "reminder_key_invalid",
            "Provide one opaque Idempotency-Key using 16 to 120 ASCII letters, digits, underscores or hyphens",
        )
    return values[0]


def fingerprint(key: str, value: dict) -> str:
    # The high-entropy caller key is not stored. Keyed digests avoid keeping
    # another content copy or an easily dictionary-tested unkeyed text digest.
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hmac.new(key.encode(), encoded, hashlib.sha256).hexdigest()


def confirmation(row: dict, key: str, *, replayed: bool) -> dict:
    return {
        **{
            field: row[field]
            for field in ("id", "draft_id", "prospect_id", "title", "due_at", "status")
        },
        "creation_key": key,
        "replayed": replayed,
    }


def lookup(connection, member: dict, key: str, body: dict) -> dict | None:
    receipt = connection.execute(
        "SELECT * FROM reminder_creation_receipts WHERE workspace_id=? AND actor_user_id=? AND key_hash=?",
        (member["workspace_id"], member["user_id"], hashlib.sha256(key.encode()).hexdigest()),
    ).fetchone()
    if receipt is not None:
        if not hmac.compare_digest(receipt["request_hash"], fingerprint(key, body)):
            raise ReplayError(
                409,
                "reminder_key_conflict",
                "This reminder retry reference belongs to different submitted values. Retry the original values or check the saved reminders; no new reminder was created.",
            )
        row = connection.execute(
            "SELECT * FROM reminders WHERE id=? AND workspace_id=?",
            (receipt["reminder_id"], member["workspace_id"]),
        ).fetchone()
        if row is None or not hmac.compare_digest(
            receipt["result_hash"], fingerprint(key, dict(row))
        ):
            raise ReplayError(
                409,
                "reminder_receipt_unavailable",
                "The original reminder was removed or changed. Check the current reminders; this retry did not recreate or reopen it.",
            )
        return confirmation(dict(row), key, replayed=True)
    count = connection.execute(
        "SELECT COUNT(*) FROM reminder_creation_receipts WHERE workspace_id=? AND actor_user_id=?",
        (member["workspace_id"], member["user_id"]),
    ).fetchone()[0]
    if count >= RECEIPT_LIMIT:
        raise ReplayError(
            409,
            "reminder_receipt_limit",
            "The reminder retry-reference limit was reached. Existing references still work; no new reminder was created.",
        )
    return None


def remember(connection, member: dict, key: str, body: dict, row: dict) -> dict:
    connection.execute(
        "INSERT INTO reminder_creation_receipts(workspace_id,actor_user_id,key_hash,request_hash,result_hash,reminder_id,created_at) VALUES (?,?,?,?,?,?,?)",
        (
            member["workspace_id"],
            member["user_id"],
            hashlib.sha256(key.encode()).hexdigest(),
            fingerprint(key, body),
            fingerprint(key, row),
            row["id"],
            db.now(),
        ),
    )
    return confirmation(row, key, replayed=False)
