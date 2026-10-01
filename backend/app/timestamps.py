from __future__ import annotations

import re
from datetime import UTC, datetime

TIMESTAMP = re.compile(
    r"\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d"
    r"(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)"
)


def canonical_timestamp(value: str) -> str:
    """Validate a timezone-explicit instant and normalize new writes only."""
    if not TIMESTAMP.fullmatch(value):
        raise ValueError("Use an ISO date and time with seconds and an explicit timezone")
    try:
        instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return instant.astimezone(UTC).isoformat(timespec="microseconds")
    except (ValueError, OverflowError) as exc:
        raise ValueError("Use a valid calendar date and time") from exc


def timestamp_sort_key(value: object) -> str | None:
    """Read-only UTC key with microseconds; never infer a legacy missing timezone."""
    if not isinstance(value, str):
        return None
    try:
        return canonical_timestamp(value)
    except ValueError:
        # Invalid legacy records remain visible, ordered last by their stable ID.
        return None
