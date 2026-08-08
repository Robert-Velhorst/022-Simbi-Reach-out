from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from .db import fetch_all, fetch_one, migrate

ACTIONABLE_STATES = ("needs_review", "approved", "handoff_created", "ambiguous")


def _next_action(state: str) -> str:
    return {
        "needs_review": "Review the draft in Simbi Reach-Out.",
        "approved": "Prepare the manual provider handoff in Simbi Reach-Out.",
        "handoff_created": "Record the manual handoff outcome in Simbi Reach-Out.",
        "ambiguous": "Resolve the uncertain handoff outcome before any follow-up.",
    }[state]


def build_hai_feed(
    workspace_id: int | None = None, include_content: bool = False
) -> dict[str, Any]:
    """Build HAI's generic JSON feed without exposing credentials or provider URLs."""
    migrate()
    if workspace_id is None:
        workspaces = fetch_all("SELECT id FROM workspaces ORDER BY id LIMIT 2")
        if len(workspaces) != 1:
            raise ValueError("Choose --workspace-id when the database contains multiple workspaces")
        workspace_id = int(workspaces[0]["id"])
    workspace = fetch_one("SELECT id,name FROM workspaces WHERE id=?", (workspace_id,))
    if not workspace:
        raise ValueError(f"Workspace {workspace_id} does not exist")
    placeholders = ",".join("?" for _ in ACTIONABLE_STATES)
    rows = fetch_all(
        "SELECT d.id,d.subject,d.body,d.state,d.quality_score,d.safety_flags,d.updated_at,"
        "c.name AS campaign_name,p.name AS prospect_name "
        "FROM drafts d JOIN campaigns c ON c.id=d.campaign_id "
        "JOIN prospects p ON p.id=d.prospect_id "
        f"WHERE d.workspace_id=? AND d.state IN ({placeholders}) "
        "ORDER BY d.updated_at,d.id LIMIT 500",
        (workspace_id, *ACTIONABLE_STATES),
    )
    items: list[dict[str, Any]] = []
    for row in rows:
        flags = json.loads(row["safety_flags"] or "[]")
        content_lines = [
            f"Campaign: {row['campaign_name']}",
            f"Workflow state: {row['state']}",
            f"Quality score: {row['quality_score']}/100",
            f"Safety flags: {', '.join(flags) if flags else 'none'}",
            f"Next action: {_next_action(row['state'])}",
        ]
        metadata: dict[str, Any] = {
            "schemaVersion": 1,
            "state": row["state"],
            "qualityScore": row["quality_score"],
            "safetyFlags": flags,
            "contentIncluded": include_content,
            "reviewRequired": True,
            "automaticSendingAllowed": False,
        }
        if include_content:
            content_lines.extend(
                [
                    f"Prospect: {row['prospect_name']}",
                    f"Subject: {row['subject']}",
                    "Draft body:",
                    row["body"],
                ]
            )
        items.append(
            {
                "externalId": f"simbi-draft-{row['id']}",
                "threadId": f"simbi-campaign-{hashlib.sha256(row['campaign_name'].encode()).hexdigest()[:16]}",
                "title": f"Simbi review: {row['campaign_name']}",
                "content": "\n".join(content_lines),
                "sourceUri": f"simbi://draft/{row['id']}",
                "itemType": "message",
                "provider": "generic_json_feed",
                "accountLabel": "Simbi Reach-Out",
                "projectKey": "022-Simbi-Reach-out",
                "receivedAt": row["updated_at"],
                "metadata": metadata,
            }
        )
    cursor = max((row["updated_at"] for row in rows), default="empty")
    return {"cursor": cursor, "items": items}


def export_hai_feed(
    destination: Path, workspace_id: int | None = None, include_content: bool = False
) -> tuple[Path, int, bool]:
    target = destination.resolve()
    if target.suffix.lower() != ".json":
        raise ValueError("HAI feed destination must be a .json file")
    payload = build_hai_feed(workspace_id, include_content)
    encoded = (json.dumps(payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.read_bytes() == encoded:
        return target, len(payload["items"]), False
    temporary_name = ""
    try:
        with NamedTemporaryFile("wb", dir=target.parent, delete=False) as temporary:
            temporary.write(encoded)
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_name = temporary.name
        Path(temporary_name).replace(target)
    finally:
        if temporary_name:
            Path(temporary_name).unlink(missing_ok=True)
    return target, len(payload["items"]), True
