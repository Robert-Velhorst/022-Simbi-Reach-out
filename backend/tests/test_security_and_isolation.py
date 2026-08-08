from __future__ import annotations

from app.db import now, transaction
from app.security import hash_password
from conftest import csrf_headers, setup_owner


def test_csrf_and_security_headers(client):
    setup_owner(client)
    failed = client.post(
        "/api/campaigns",
        json={
            "name": "Blocked request",
            "purpose": "This should fail due to the missing CSRF header",
            "lawful_basis": "Not reached because CSRF is missing",
        },
    )
    assert failed.status_code == 403
    assert failed.json()["error"]["code"] == "csrf_failed"
    response = client.get("/api/me")
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'self'" in response.headers["content-security-policy"]


def test_provider_urls_reject_credentials_http_and_host_mismatch(client):
    setup_owner(client)
    headers = csrf_headers(client)
    for url in (
        "http://simbi.com/request",
        "https://user:password@simbi.com/request",
        "https://simbi.com:8443/request",
    ):
        response = client.post(
            "/api/prospects",
            headers=headers,
            json={"name": "Unsafe URL", "source_url": url},
        )
        assert response.status_code == 422


def test_cross_workspace_records_are_not_addressable(client):
    setup_owner(client)
    headers = csrf_headers(client)
    record = client.post(
        "/api/prospects",
        headers=headers,
        json={"name": "Workspace One", "source_url": "https://simbi.com/workspace-one"},
    )
    first_id = record.json()["id"]
    with transaction() as connection:
        user_id = connection.execute(
            "INSERT INTO users(email,password_hash,display_name,created_at) VALUES (?,?,?,?)",
            (
                "other@example.test",
                hash_password("another correct horse password"),
                "Other Owner",
                now(),
            ),
        ).lastrowid
        workspace_id = connection.execute(
            "INSERT INTO workspaces(name,mode,created_at) VALUES ('Other Workspace','assisted',?)",
            (now(),),
        ).lastrowid
        connection.execute(
            "INSERT INTO memberships(user_id,workspace_id,role) VALUES (?,?,'owner')",
            (user_id, workspace_id),
        )
    client.post("/api/auth/logout", headers=headers, json={})
    login = client.post(
        "/api/auth/login",
        json={"email": "other@example.test", "password": "another correct horse password"},
    )
    assert login.status_code == 200
    attempt = client.delete(f"/api/prospects/{first_id}", headers=csrf_headers(client))
    assert attempt.status_code == 404
    assert client.get("/api/prospects").json()["total"] == 0


def test_support_bundle_is_redacted(client):
    setup_owner(client, email="private-owner@example.test")
    payload = client.get("/api/support-bundle").json()
    text = str(payload)
    assert "private-owner@example.test" not in text
    assert "password" not in text.lower()
    assert "redaction" in payload
