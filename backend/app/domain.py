from __future__ import annotations

import json
import re
from string import Formatter
from typing import Any

ALLOWED_TEMPLATE_FIELDS = {"name", "organization", "campaign", "notes"}
APPROVAL_CHECKS = {
    "source_authorized",
    "message_personalized",
    "policy_reviewed",
    "manual_send_understood",
}
TRANSITIONS = {
    "needs_review": {"approved", "declined", "suppressed"},
    "approved": {"needs_review", "handoff_created", "suppressed"},
    "handoff_created": {"sent", "ambiguous", "approved", "suppressed"},
    "ambiguous": {"sent", "approved", "suppressed"},
    "sent": {"replied", "suppressed"},
    "replied": set(),
    "declined": {"needs_review"},
    "suppressed": set(),
}


class DomainError(ValueError):
    pass


def template_fields(body: str) -> set[str]:
    fields = {field for _, field, _, _ in Formatter().parse(body) if field}
    unsupported = fields - ALLOWED_TEMPLATE_FIELDS
    if unsupported:
        raise DomainError(f"Unsupported template fields: {', '.join(sorted(unsupported))}")
    return fields


def render_template(body: str, context: dict[str, str]) -> str:
    template_fields(body)
    try:
        return body.format_map(
            {key: context.get(key, "") for key in ALLOWED_TEMPLATE_FIELDS}
        ).strip()
    except (KeyError, ValueError) as exc:
        raise DomainError("Template syntax is invalid") from exc


def assess_message(body: str, prospect: dict[str, Any]) -> tuple[int, list[str]]:
    score = 100
    flags: list[str] = []
    normalized = body.lower()
    name = str(prospect.get("name", "")).strip().lower()
    if name and name not in normalized:
        score -= 25
        flags.append("missing_name")
    if len(body) < 80:
        score -= 20
        flags.append("too_short")
    if len(body) > 1500:
        score -= 15
        flags.append("too_long")
    if not any(word in normalized for word in ("request", "project", "offer", "service", "help")):
        score -= 15
        flags.append("missing_context")
    if re.search(r"\b(buy now|limited time|guaranteed|act now)\b", normalized):
        score -= 30
        flags.append("promotional_pressure")
    if body.count("!") > 2:
        score -= 10
        flags.append("excessive_punctuation")
    if not re.search(r"\b(no thanks|not interested|do not contact|opt out)\b", normalized):
        score -= 10
        flags.append("missing_easy_decline")
    return max(0, score), flags


def parse_flags(value: str) -> list[str]:
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def require_transition(current: str, target: str) -> None:
    if target not in TRANSITIONS.get(current, set()):
        raise DomainError(f"Invalid draft transition: {current} -> {target}")
