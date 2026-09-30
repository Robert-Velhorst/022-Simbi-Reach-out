from __future__ import annotations

import os
from dataclasses import replace
from pathlib import Path

RUNTIME = Path(__file__).parent / ".runtime"
RUNTIME.mkdir(exist_ok=True)
os.environ["SIMBI_ENV"] = "test"
os.environ["SIMBI_DATABASE_PATH"] = str(RUNTIME / "test.db")
os.environ["SIMBI_FRONTEND_ORIGIN"] = "http://testserver"
os.environ["SIMBI_COOKIE_SECURE"] = "false"

import pytest  # noqa: E402
from app import privacy  # noqa: E402
from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(
        privacy, "settings", replace(settings, backup_path=tmp_path / "cleanup-backups")
    )
    for suffix in ("", "-shm", "-wal"):
        path = Path(str(settings.database_path) + suffix)
        if path.exists():
            path.unlink()
    with TestClient(app) as test_client:
        yield test_client


def remove_contact(client, prospect_id: int):
    headers = csrf_headers(client)
    preview = client.post(
        "/api/privacy/preview",
        headers=headers,
        json={"kind": "prospect", "prospect_id": prospect_id},
    )
    assert preview.status_code == 200, preview.text
    return client.post(
        "/api/privacy/confirm",
        headers=headers,
        json={
            "plan_id": preview.json()["plan_id"],
            "confirmed": True,
            "current_password": "correct horse battery staple",
        },
    )


def setup_owner(client: TestClient, email: str = "owner@example.test") -> dict:
    response = client.post(
        "/api/auth/setup",
        json={
            "display_name": "Test Owner",
            "workspace_name": "Test Workspace",
            "email": email,
            "password": "correct horse battery staple",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def csrf_headers(client: TestClient, **extra: str) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies.get("simbi_csrf"), **extra}


def draft_hash(draft_id: int) -> str:
    import hashlib

    from app.db import fetch_one

    draft = fetch_one("SELECT subject,body FROM drafts WHERE id=?", (draft_id,))
    return hashlib.sha256((draft["subject"] + "\n" + draft["body"]).encode()).hexdigest()
