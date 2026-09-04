import pytest
from app import main
from app.db import fetch_one
from conftest import csrf_headers, setup_owner


def test_password_change_revokes_sessions(client):
    setup_owner(client)
    response = client.post(
        "/api/auth/password",
        headers=csrf_headers(client),
        json={
            "current_password": "correct horse battery staple",
            "new_password": "a different long password",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"changed": True, "reauthenticate": True}
    assert fetch_one("SELECT COUNT(*) AS count FROM sessions")["count"] == 0
    assert client.get("/api/me").status_code == 401
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "owner@example.test", "password": "correct horse battery staple"},
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "owner@example.test", "password": "a different long password"},
        ).status_code
        == 200
    )


def test_password_change_requires_current_password(client):
    setup_owner(client)
    response = client.post(
        "/api/auth/password",
        headers=csrf_headers(client),
        json={
            "current_password": "incorrect current password",
            "new_password": "a different long password",
        },
    )
    assert response.status_code == 403
    assert client.get("/api/me").status_code == 200


@pytest.mark.parametrize("supplied", [None, "wrong-token"])
def test_production_setup_requires_operator_token(client, monkeypatch, supplied):
    # SimpleNamespace supports introducing the new setting before implementation.
    from types import SimpleNamespace

    configuration = dict(vars(main.settings)) | {
        "environment": "production",
        "setup_token": "x" * 40,
        "demo_mode": False,
    }
    monkeypatch.setattr(main, "settings", SimpleNamespace(**configuration))
    assert client.get("/api/auth/status").json().get("setup_token_required") is True
    payload = {
        "display_name": "Owner",
        "workspace_name": "Workspace",
        "email": "owner@example.test",
        "password": "correct horse battery staple",
    }
    if supplied:
        payload["setup_token"] = supplied
    response = client.post("/api/auth/setup", json=payload)
    assert response.status_code == 403
    assert fetch_one("SELECT COUNT(*) AS count FROM users")["count"] == 0
    payload["setup_token"] = "x" * 40
    assert client.post("/api/auth/setup", json=payload).status_code == 201


def test_setup_rechecks_inside_write_transaction(client, monkeypatch):
    original = main.hash_password
    competing = False

    def concurrent_setup(password):
        nonlocal competing
        if not competing:
            competing = True
            setup_owner(client, "competitor@example.test")
        return original(password)

    monkeypatch.setattr(main, "hash_password", concurrent_setup)
    response = client.post(
        "/api/auth/setup",
        json={
            "display_name": "Other owner",
            "workspace_name": "Other workspace",
            "email": "other@example.test",
            "password": "correct horse battery staple",
        },
    )
    assert response.status_code == 409
    assert fetch_one("SELECT COUNT(*) AS count FROM users")["count"] == 1


def test_ready_rejects_stopped_required_worker(client, monkeypatch):
    from types import SimpleNamespace

    configuration = dict(vars(main.settings)) | {"require_maintenance": True}
    monkeypatch.setattr(main, "settings", SimpleNamespace(**configuration))
    response = client.get("/api/health/ready")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "maintenance_unavailable"


def test_racing_old_password_login_cannot_survive_password_change(client, monkeypatch):
    setup_owner(client)
    original = main.verify_password
    changed = False
    headers = csrf_headers(client)

    def race(password, encoded):
        nonlocal changed
        result = original(password, encoded)
        if not changed:
            changed = True
            response = client.post(
                "/api/auth/password",
                headers=headers,
                json={
                    "current_password": "correct horse battery staple",
                    "new_password": "a different long password",
                },
            )
            assert response.status_code == 200
        return result

    monkeypatch.setattr(main, "verify_password", race)
    response = client.post(
        "/api/auth/login",
        json={"email": "owner@example.test", "password": "correct horse battery staple"},
    )
    assert response.status_code == 401
    assert fetch_one("SELECT COUNT(*) AS count FROM sessions")["count"] == 0
