from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import re
import sqlite3
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import Cookie, Depends, FastAPI, Header, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import ROOT, settings
from .db import (
    audit,
    connect,
    database_size,
    fetch_all,
    fetch_one,
    migrate,
    now,
    runtime_guard,
    transaction,
)
from .domain import (
    APPROVAL_CHECKS,
    DomainError,
    assess_message,
    parse_flags,
    render_template,
    require_transition,
    template_fields,
)
from .security import (
    clean_text,
    csrf_token,
    hash_password,
    session_token,
    token_hash,
    validate_email,
    validate_provider_url,
    verify_password,
)

SESSION_COOKIE = "simbi_session"
CSRF_COOKIE = "simbi_csrf"
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
DUMMY_PASSWORD_HASH = hash_password("simbi constant-time credential check")


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None):
        self.status = status
        self.code = code
        self.message = message
        self.details = details


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SetupBody(StrictModel):
    display_name: str = Field(min_length=2, max_length=80)
    workspace_name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=200)
    setup_token: str | None = Field(default=None, max_length=200)


class LoginBody(StrictModel):
    email: str
    password: str


class PasswordBody(StrictModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=12, max_length=200)


class CampaignBody(StrictModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=1000)
    purpose: str = Field(min_length=10, max_length=500)
    lawful_basis: str = Field(min_length=5, max_length=300)
    daily_limit: int = Field(default=10, ge=1, le=50)
    cooldown_minutes: int = Field(default=1440, ge=60, le=43200)


class CampaignStatusBody(StrictModel):
    status: Literal["draft", "active", "paused", "archived"]


class ProspectBody(StrictModel):
    name: str = Field(min_length=2, max_length=120)
    organization: str = Field(default="", max_length=160)
    provider: str = Field(default="simbi", min_length=2, max_length=40)
    source_url: str = Field(min_length=8, max_length=1000)
    contact_handle: str = Field(default="", max_length=160)
    notes: str = Field(default="", max_length=3000)
    consent_status: Literal["unknown", "contextual", "consented", "opted_out", "blocked"] = (
        "unknown"
    )


class ImportBody(StrictModel):
    csv_text: str
    commit: bool = False


class TemplateBody(StrictModel):
    name: str = Field(min_length=2, max_length=120)
    provider: str = Field(default="simbi", min_length=2, max_length=40)
    subject: str = Field(default="", max_length=200)
    body: str = Field(min_length=20, max_length=5000)


class DraftBody(StrictModel):
    campaign_id: int
    prospect_id: int
    template_id: int


class DraftEditBody(StrictModel):
    subject: str = Field(default="", max_length=200)
    body: str = Field(min_length=20, max_length=5000)


class ReviewBody(StrictModel):
    decision: Literal["approve", "decline"]
    acknowledged_checks: list[str] = Field(default_factory=list)
    expected_content_hash: str | None = Field(default=None, min_length=64, max_length=64)


class HandoffOutcomeBody(StrictModel):
    outcome: Literal["sent", "ambiguous", "cancelled"]


class ReplyBody(StrictModel):
    draft_id: int
    body: str = Field(min_length=1, max_length=5000)
    received_at: str | None = None


class ReminderBody(StrictModel):
    draft_id: int | None = None
    prospect_id: int | None = None
    title: str = Field(min_length=2, max_length=300)
    due_at: str


class ReminderStatusBody(StrictModel):
    status: Literal["open", "done", "cancelled"]


class ComplianceBody(StrictModel):
    reviewed_simbi_terms: bool
    confirmed_no_scraping: bool
    confirmed_manual_send: bool
    confirmed_suppression_process: bool


class ProviderBody(StrictModel):
    provider: str = Field(min_length=2, max_length=40)
    base_url: str = Field(min_length=8, max_length=1000)


class PauseBody(StrictModel):
    paused: bool


class SuppressionBody(StrictModel):
    prospect_id: int
    reason: str = Field(min_length=3, max_length=500)


class TeamMemberBody(StrictModel):
    display_name: str = Field(min_length=2, max_length=80)
    email: str
    password: str = Field(min_length=12, max_length=200)
    role: Literal["admin", "editor", "viewer"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    with runtime_guard():
        migrate()
        yield


app = FastAPI(
    title="Simbi Reach-Out API",
    version="1.0.0",
    docs_url="/api/docs" if settings.environment != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))


@app.middleware("http")
async def security_and_request_middleware(request: Request, call_next):
    supplied_request_id = request.headers.get("X-Request-ID", "")
    request_id = (
        supplied_request_id
        if REQUEST_ID_RE.fullmatch(supplied_request_id)
        else session_token()[:16]
    )
    request.state.request_id = request_id
    csrf_exempt = request.method == "POST" and request.url.path in {
        "/api/auth/setup",
        "/api/auth/login",
    }
    if request.method not in {"GET", "HEAD", "OPTIONS"} and not csrf_exempt:
        header = request.headers.get("X-CSRF-Token", "")
        cookie = request.cookies.get(CSRF_COOKIE, "")
        if not header or not cookie or header != cookie:
            return error_response(403, "csrf_failed", "Refresh the page and try again", request_id)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; connect-src 'self' " + settings.frontend_origin
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    if settings.environment == "production":
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


def error_response(status: int, code: str, message: str, request_id: str, details: Any = None):
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details,
                "request_id": request_id,
            }
        },
    )


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return error_response(exc.status, exc.code, exc.message, request.state.request_id, exc.details)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    return error_response(
        422,
        "validation_failed",
        "Check the highlighted fields and try again",
        request.state.request_id,
        [{key: error[key] for key in ("loc", "type", "msg")} for error in exc.errors()],
    )


@app.exception_handler(sqlite3.IntegrityError)
async def integrity_error_handler(request: Request, _: sqlite3.IntegrityError):
    return error_response(
        409,
        "conflict",
        "A record with these identifying details already exists",
        request.state.request_id,
    )


def set_auth_cookies(response: Response, raw_session: str, raw_csrf: str) -> None:
    max_age = settings.session_hours * 3600
    response.set_cookie(
        SESSION_COOKIE,
        raw_session,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE,
        raw_csrf,
        max_age=max_age,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )


def issue_session(connection: sqlite3.Connection, user_id: int) -> tuple[str, str]:
    raw_session = session_token()
    raw_csrf = csrf_token()
    created = now()
    expires = (
        (datetime.now(UTC) + timedelta(hours=settings.session_hours))
        .replace(microsecond=0)
        .isoformat()
    )
    connection.execute(
        "INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (token_hash(raw_session), user_id, expires, created),
    )
    return raw_session, raw_csrf


def login_fingerprint(request: Request, email: str) -> str:
    client_host = request.client.host if request.client else "unknown"
    return hashlib.sha256(f"{client_host}|{email}".encode()).hexdigest()


def enforce_login_limit(fingerprint: str) -> None:
    attempt = fetch_one("SELECT * FROM login_attempts WHERE fingerprint=?", (fingerprint,))
    if not attempt or not attempt["locked_until"] or attempt["locked_until"] <= now():
        return
    retry_after = max(
        1,
        int((datetime.fromisoformat(attempt["locked_until"]) - datetime.now(UTC)).total_seconds()),
    )
    raise AppError(
        429,
        "login_rate_limited",
        "Too many sign-in attempts. Wait before trying again.",
        {"retry_after_seconds": retry_after},
    )


def record_login_failure(fingerprint: str) -> None:
    timestamp = now()
    window_cutoff = (
        (datetime.now(UTC) - timedelta(minutes=settings.login_window_minutes))
        .replace(microsecond=0)
        .isoformat()
    )
    with transaction() as connection:
        attempt = connection.execute(
            "SELECT * FROM login_attempts WHERE fingerprint=?", (fingerprint,)
        ).fetchone()
        if not attempt or attempt["window_started_at"] <= window_cutoff:
            failures = 1
            window_started_at = timestamp
        else:
            failures = int(attempt["failures"]) + 1
            window_started_at = attempt["window_started_at"]
        locked_until = None
        if failures >= settings.max_failed_logins:
            locked_until = (
                (datetime.now(UTC) + timedelta(minutes=settings.login_lock_minutes))
                .replace(microsecond=0)
                .isoformat()
            )
        connection.execute(
            "INSERT INTO login_attempts(fingerprint,failures,window_started_at,locked_until,updated_at) "
            "VALUES (?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET failures=excluded.failures,"
            "window_started_at=excluded.window_started_at,locked_until=excluded.locked_until,"
            "updated_at=excluded.updated_at",
            (fingerprint, failures, window_started_at, locked_until, timestamp),
        )


def current_member(
    raw_session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> dict[str, Any]:
    if not raw_session:
        raise AppError(401, "authentication_required", "Sign in to continue")
    member = fetch_one(
        "SELECT u.id AS user_id, u.email, u.display_name, m.workspace_id, m.role, "
        "w.name AS workspace_name, w.mode, w.compliance_ack_at, w.paused_at "
        "FROM sessions s JOIN users u ON u.id=s.user_id "
        "JOIN memberships m ON m.user_id=u.id JOIN workspaces w ON w.id=m.workspace_id "
        "WHERE s.token_hash=? AND s.expires_at>?",
        (token_hash(raw_session), now()),
    )
    if not member:
        raise AppError(401, "session_expired", "Your session expired; sign in again")
    return member


Member = Annotated[dict[str, Any], Depends(current_member)]


def require_role(member: dict[str, Any], *roles: str) -> None:
    if member["role"] not in roles:
        raise AppError(403, "permission_denied", "Your role cannot perform this action")


def owned(connection: sqlite3.Connection, table: str, record_id: int, workspace_id: int):
    allowed = {"campaigns", "prospects", "templates", "drafts", "handoffs", "reminders"}
    if table not in allowed:
        raise RuntimeError("Invalid table")
    row = connection.execute(
        f"SELECT * FROM {table} WHERE id=? AND workspace_id=?", (record_id, workspace_id)
    ).fetchone()
    if not row:
        raise AppError(404, "not_found", "The requested record was not found")
    return dict(row)


def list_page(
    table: str,
    workspace_id: int,
    limit: int,
    offset: int,
    search: str,
    order: str,
) -> dict[str, Any]:
    columns = {
        "campaigns": "name || ' ' || description",
        "prospects": "name || ' ' || organization || ' ' || notes",
        "templates": "name || ' ' || body",
    }
    order_by = {
        "campaigns": {"newest": "created_at DESC", "name": "name COLLATE NOCASE"},
        "prospects": {"newest": "created_at DESC", "name": "name COLLATE NOCASE"},
        "templates": {"newest": "created_at DESC", "name": "name COLLATE NOCASE"},
    }
    if table not in columns or order not in order_by[table]:
        raise AppError(400, "invalid_sort", "The requested sort is not supported")
    term = f"%{search.strip()}%"
    where = f"workspace_id=? AND ({columns[table]}) LIKE ?"
    items = fetch_all(
        f"SELECT * FROM {table} WHERE {where} ORDER BY {order_by[table][order]} LIMIT ? OFFSET ?",
        (workspace_id, term, limit, offset),
    )
    total = fetch_one(f"SELECT COUNT(*) AS count FROM {table} WHERE {where}", (workspace_id, term))
    return {"items": items, "total": total["count"], "limit": limit, "offset": offset}


@app.get("/api/health/live")
def live():
    return {"status": "ok"}


@app.get("/api/health/ready")
def ready():
    connection = None
    try:
        connection = connect()
        connection.execute("SELECT 1").fetchone()
        if settings.require_maintenance:
            from .worker import healthcheck

            if not healthcheck():
                raise AppError(
                    503, "maintenance_unavailable", "Maintenance is not running successfully"
                )
        return {"status": "ready", "database": "reachable"}
    except sqlite3.Error as exc:
        raise AppError(503, "database_unavailable", "The local database is unavailable") from exc
    finally:
        if connection is not None:
            connection.close()


@app.get("/api/auth/status")
def auth_status():
    count = fetch_one("SELECT COUNT(*) AS count FROM users")
    return {
        "setup_required": count["count"] == 0,
        "setup_token_required": settings.environment == "production" or bool(settings.setup_token),
        "environment": settings.environment,
        "demo_mode": settings.demo_mode,
    }


@app.post("/api/auth/setup", status_code=201)
def setup(body: SetupBody, response: Response):
    if fetch_one("SELECT id FROM users LIMIT 1"):
        raise AppError(409, "setup_complete", "Initial setup has already been completed")
    if settings.environment == "production" or settings.setup_token:
        if not settings.setup_token or not hmac.compare_digest(
            (body.setup_token or "").encode(), settings.setup_token.encode()
        ):
            raise AppError(403, "setup_token_invalid", "A valid operator setup token is required")
    try:
        email = validate_email(body.email)
        password = hash_password(body.password)
        display_name = clean_text(body.display_name, "Display name", 80, 2)
        workspace_name = clean_text(body.workspace_name, "Workspace name", 100, 2)
    except ValueError as exc:
        raise AppError(422, "validation_failed", str(exc)) from exc
    with transaction() as connection:
        if connection.execute("SELECT id FROM users LIMIT 1").fetchone():
            raise AppError(409, "setup_complete", "Initial setup has already been completed")
        timestamp = now()
        user_id = connection.execute(
            "INSERT INTO users(email,password_hash,display_name,created_at) VALUES (?,?,?,?)",
            (email, password, display_name, timestamp),
        ).lastrowid
        workspace_id = connection.execute(
            "INSERT INTO workspaces(name,mode,retention_days,created_at) VALUES (?,?,?,?)",
            (
                workspace_name,
                "demo" if settings.demo_mode else "assisted",
                settings.retention_days,
                timestamp,
            ),
        ).lastrowid
        connection.execute(
            "INSERT INTO memberships(user_id,workspace_id,role) VALUES (?,?,?)",
            (user_id, workspace_id, "owner"),
        )
        connection.execute(
            "INSERT INTO provider_settings(workspace_id,provider,base_url,mode,updated_at) "
            "VALUES (?,?,?,?,?)",
            (workspace_id, "simbi", "https://simbi.com/", "assisted", timestamp),
        )
        audit(connection, workspace_id, user_id, "workspace.created", "workspace", workspace_id)
        raw_session, raw_csrf = issue_session(connection, user_id)
    set_auth_cookies(response, raw_session, raw_csrf)
    return {"status": "created", "csrf_token": raw_csrf}


@app.post("/api/auth/login")
def login(body: LoginBody, request: Request, response: Response):
    try:
        email = validate_email(body.email)
    except ValueError as exc:
        raise AppError(401, "invalid_credentials", "Email or password is incorrect") from exc
    fingerprint = login_fingerprint(request, email)
    enforce_login_limit(fingerprint)
    user = fetch_one("SELECT * FROM users WHERE email=?", (email,))
    encoded_password = user["password_hash"] if user else DUMMY_PASSWORD_HASH
    if not verify_password(body.password, encoded_password) or not user:
        record_login_failure(fingerprint)
        raise AppError(401, "invalid_credentials", "Email or password is incorrect")
    with transaction() as connection:
        current_user = connection.execute(
            "SELECT password_hash FROM users WHERE id=?", (user["id"],)
        ).fetchone()
        if not current_user or current_user["password_hash"] != encoded_password:
            raise AppError(401, "invalid_credentials", "Credentials changed; sign in again")
        connection.execute("DELETE FROM login_attempts WHERE fingerprint=?", (fingerprint,))
        connection.execute("DELETE FROM sessions WHERE expires_at<=?", (now(),))
        raw_session, raw_csrf = issue_session(connection, user["id"])
    set_auth_cookies(response, raw_session, raw_csrf)
    return {"status": "authenticated", "csrf_token": raw_csrf}


@app.post("/api/auth/logout")
def logout(
    response: Response, member: Member, raw_session: str | None = Cookie(None, alias=SESSION_COOKIE)
):
    del member
    if raw_session:
        with transaction() as connection:
            connection.execute(
                "DELETE FROM sessions WHERE token_hash=?", (token_hash(raw_session),)
            )
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return {"status": "signed_out"}


@app.post("/api/auth/password")
def change_password(body: PasswordBody, response: Response, member: Member):
    with transaction() as connection:
        user = connection.execute("SELECT * FROM users WHERE id=?", (member["user_id"],)).fetchone()
        if not verify_password(body.current_password, user["password_hash"]):
            raise AppError(403, "current_password_invalid", "The current password is incorrect")
        connection.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (hash_password(body.new_password), member["user_id"]),
        )
        connection.execute("DELETE FROM sessions WHERE user_id=?", (member["user_id"],))
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "account.password_changed",
            "user",
            member["user_id"],
        )
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return {"changed": True, "reauthenticate": True}


@app.get("/api/me")
def me(member: Member):
    return member | {"environment": settings.environment, "demo_mode": settings.demo_mode}


@app.get("/api/overview")
def overview(member: Member):
    workspace_id = member["workspace_id"]
    counts = fetch_one(
        "SELECT "
        "(SELECT COUNT(*) FROM drafts WHERE workspace_id=? AND state='needs_review') AS reviews, "
        "(SELECT COUNT(*) FROM reminders WHERE workspace_id=? AND status='open' AND due_at<=?) AS due, "
        "(SELECT COUNT(*) FROM replies WHERE workspace_id=?) AS replies, "
        "(SELECT COUNT(*) FROM prospects WHERE workspace_id=?) AS prospects",
        (workspace_id, workspace_id, now(), workspace_id, workspace_id),
    )
    queue = fetch_all(
        "SELECT d.id,d.state,d.quality_score,d.safety_flags,p.name AS prospect_name,c.name AS campaign_name,"
        "d.updated_at FROM drafts d JOIN prospects p ON p.id=d.prospect_id "
        "JOIN campaigns c ON c.id=d.campaign_id WHERE d.workspace_id=? "
        "AND d.state IN ('needs_review','ambiguous') ORDER BY CASE d.state WHEN 'ambiguous' THEN 0 ELSE 1 END, "
        "d.quality_score, d.updated_at LIMIT 6",
        (workspace_id,),
    )
    for item in queue:
        item["safety_flags"] = parse_flags(item["safety_flags"])
    campaigns = fetch_all(
        "SELECT c.id,c.name,c.status,COUNT(d.id) AS total,"
        "SUM(CASE WHEN d.state IN ('approved','handoff_created','sent','replied') THEN 1 ELSE 0 END) AS reviewed "
        "FROM campaigns c LEFT JOIN drafts d ON d.campaign_id=c.id WHERE c.workspace_id=? "
        "GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 5",
        (workspace_id,),
    )
    reminders = fetch_all(
        "SELECT r.*,p.name AS prospect_name,c.name AS campaign_name FROM reminders r "
        "LEFT JOIN drafts d ON d.id=r.draft_id LEFT JOIN prospects p ON p.id=COALESCE(r.prospect_id,d.prospect_id) "
        "LEFT JOIN campaigns c ON c.id=d.campaign_id WHERE r.workspace_id=? AND r.status='open' "
        "ORDER BY r.due_at LIMIT 5",
        (workspace_id,),
    )
    events = fetch_all(
        "SELECT a.*,u.display_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id "
        "WHERE a.workspace_id=? ORDER BY a.created_at DESC LIMIT 5",
        (workspace_id,),
    )
    return {
        "counts": counts,
        "queue": queue,
        "campaigns": campaigns,
        "reminders": reminders,
        "events": events,
        "safety": {
            "local_only": True,
            "assisted_send_only": True,
            "compliance_acknowledged": bool(member["compliance_ack_at"]),
            "paused": bool(member["paused_at"]),
            "demo_mode": settings.demo_mode,
        },
    }


@app.get("/api/campaigns")
def list_campaigns(
    member: Member,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    search: str = Query("", max_length=200),
    order: str = Query("newest"),
):
    return list_page("campaigns", member["workspace_id"], limit, offset, search, order)


@app.post("/api/campaigns", status_code=201)
def create_campaign(body: CampaignBody, member: Member):
    require_role(member, "owner", "admin", "editor")
    timestamp = now()
    with transaction() as connection:
        record_id = connection.execute(
            "INSERT INTO campaigns(workspace_id,name,description,purpose,lawful_basis,daily_limit,"
            "cooldown_minutes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                member["workspace_id"],
                body.name,
                body.description,
                body.purpose,
                body.lawful_basis,
                body.daily_limit,
                body.cooldown_minutes,
                timestamp,
                timestamp,
            ),
        ).lastrowid
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "campaign.created",
            "campaign",
            record_id,
        )
    return fetch_one("SELECT * FROM campaigns WHERE id=?", (record_id,))


@app.patch("/api/campaigns/{campaign_id}/status")
def update_campaign_status(campaign_id: int, body: CampaignStatusBody, member: Member):
    require_role(member, "owner", "admin", "editor")
    if body.status == "active" and not member["compliance_ack_at"]:
        raise AppError(
            409, "compliance_required", "Complete the compliance review before activating outreach"
        )
    with transaction() as connection:
        owned(connection, "campaigns", campaign_id, member["workspace_id"])
        connection.execute(
            "UPDATE campaigns SET status=?,updated_at=? WHERE id=?",
            (body.status, now(), campaign_id),
        )
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            f"campaign.{body.status}",
            "campaign",
            campaign_id,
        )
    return {"status": body.status}


@app.get("/api/prospects")
def list_prospects(
    member: Member,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    search: str = Query("", max_length=200),
    order: str = Query("newest"),
):
    return list_page("prospects", member["workspace_id"], limit, offset, search, order)


def validate_prospect(body: ProspectBody) -> tuple[str, str]:
    provider = clean_text(body.provider.lower(), "Provider", 40, 2)
    source_url = validate_provider_url(body.source_url)
    return provider, source_url


@app.post("/api/prospects", status_code=201)
def create_prospect(body: ProspectBody, member: Member):
    require_role(member, "owner", "admin", "editor")
    try:
        provider, source_url = validate_prospect(body)
    except ValueError as exc:
        raise AppError(422, "validation_failed", str(exc)) from exc
    timestamp = now()
    with transaction() as connection:
        record_id = connection.execute(
            "INSERT INTO prospects(workspace_id,name,organization,provider,source_url,contact_handle,notes,"
            "consent_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                member["workspace_id"],
                body.name,
                body.organization,
                provider,
                source_url,
                body.contact_handle,
                body.notes,
                "opted_out"
                if is_suppressed(connection, member["workspace_id"], provider, source_url)
                else body.consent_status,
                timestamp,
                timestamp,
            ),
        ).lastrowid
        if body.consent_status in {"opted_out", "blocked"}:
            persist_intake_restriction(
                connection, member, record_id, provider, source_url, body.consent_status
            )
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "prospect.created",
            "prospect",
            record_id,
            {"provider": provider},
        )
    return fetch_one("SELECT * FROM prospects WHERE id=?", (record_id,))


def parse_import(text: str) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    if len(text.encode()) > settings.max_import_bytes:
        raise AppError(
            413, "import_too_large", "The CSV is larger than the configured import limit"
        )
    reader = csv.DictReader(io.StringIO(text))
    required = {"name", "source_url"}
    if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
        raise AppError(422, "invalid_csv", "CSV requires name and source_url columns")
    valid: list[dict[str, str]] = []
    errors: list[dict[str, Any]] = []
    for line, row in enumerate(reader, start=2):
        try:
            payload = ProspectBody(
                **{
                    key: value
                    for key, value in row.items()
                    if key in ProspectBody.model_fields and value not in {None, ""}
                }
            )
            provider, source_url = validate_prospect(payload)
            data = payload.model_dump()
            data["provider"] = provider
            data["source_url"] = source_url
            valid.append(data)
        except (ValueError, RequestValidationError, Exception) as exc:
            errors.append({"line": line, "message": str(exc)[:300]})
        if len(valid) + len(errors) > 5000:
            raise AppError(413, "too_many_rows", "Imports are limited to 5,000 rows")
    return valid, errors


@app.post("/api/prospects/import")
def import_prospects(body: ImportBody, member: Member):
    require_role(member, "owner", "admin", "editor")
    valid, errors = parse_import(body.csv_text)
    inserted = 0
    duplicates = 0
    if body.commit and errors:
        raise AppError(422, "import_has_errors", "Fix CSV errors before committing", errors[:50])
    if body.commit:
        with transaction() as connection:
            timestamp = now()
            for row in valid:
                cursor = connection.execute(
                    "INSERT OR IGNORE INTO prospects(workspace_id,name,organization,provider,source_url,"
                    "contact_handle,notes,consent_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (
                        member["workspace_id"],
                        row["name"],
                        row["organization"],
                        row["provider"],
                        row["source_url"],
                        row["contact_handle"],
                        row["notes"],
                        "opted_out"
                        if is_suppressed(
                            connection, member["workspace_id"], row["provider"], row["source_url"]
                        )
                        else row["consent_status"],
                        timestamp,
                        timestamp,
                    ),
                )
                inserted += cursor.rowcount
                duplicates += 1 - cursor.rowcount
                if row["consent_status"] in {"opted_out", "blocked"}:
                    prospect_id = connection.execute(
                        "SELECT id FROM prospects WHERE workspace_id=? AND provider=? AND source_url=?",
                        (member["workspace_id"], row["provider"], row["source_url"]),
                    ).fetchone()["id"]
                    persist_intake_restriction(
                        connection,
                        member,
                        prospect_id,
                        row["provider"],
                        row["source_url"],
                        row["consent_status"],
                    )
            audit(
                connection,
                member["workspace_id"],
                member["user_id"],
                "prospect.imported",
                "prospect",
                "bulk",
                {"inserted": inserted, "duplicates": duplicates},
            )
    return {
        "valid": len(valid),
        "errors": errors[:50],
        "inserted": inserted,
        "duplicates": duplicates,
        "committed": body.commit,
    }


@app.delete("/api/prospects/{prospect_id}")
def delete_prospect(prospect_id: int, member: Member):
    require_role(member, "owner", "admin")
    with transaction() as connection:
        record = owned(connection, "prospects", prospect_id, member["workspace_id"])
        if record["consent_status"] in {"opted_out", "blocked"}:
            persist_intake_restriction(
                connection,
                member,
                prospect_id,
                record["provider"],
                record["source_url"],
                record["consent_status"],
            )
        connection.execute("DELETE FROM prospects WHERE id=?", (prospect_id,))
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "prospect.deleted",
            "prospect",
            prospect_id,
            {"provider": record["provider"]},
        )
    return {"status": "deleted"}


@app.get("/api/templates")
def list_templates(
    member: Member,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    search: str = Query("", max_length=200),
    order: str = Query("newest"),
):
    return list_page("templates", member["workspace_id"], limit, offset, search, order)


@app.post("/api/templates", status_code=201)
def create_template(body: TemplateBody, member: Member):
    require_role(member, "owner", "admin", "editor")
    try:
        fields = template_fields(body.body)
    except DomainError as exc:
        raise AppError(422, "invalid_template", str(exc)) from exc
    timestamp = now()
    with transaction() as connection:
        record_id = connection.execute(
            "INSERT INTO templates(workspace_id,name,provider,subject,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
            (
                member["workspace_id"],
                body.name,
                body.provider.lower(),
                body.subject,
                body.body,
                timestamp,
                timestamp,
            ),
        ).lastrowid
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "template.created",
            "template",
            record_id,
            {"fields": sorted(fields)},
        )
    return fetch_one("SELECT * FROM templates WHERE id=?", (record_id,))


@app.get("/api/drafts")
def list_drafts(
    member: Member,
    state: str = Query("", max_length=30),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    parameters: list[Any] = [member["workspace_id"]]
    where = "d.workspace_id=?"
    if state:
        where += " AND d.state=?"
        parameters.append(state)
    total = fetch_one(f"SELECT COUNT(*) AS count FROM drafts d WHERE {where}", tuple(parameters))
    parameters.extend([limit, offset])
    items = fetch_all(
        f"SELECT d.*,p.name AS prospect_name,p.organization,p.source_url,p.consent_status,"
        f"c.name AS campaign_name,t.name AS template_name FROM drafts d "
        f"JOIN prospects p ON p.id=d.prospect_id JOIN campaigns c ON c.id=d.campaign_id "
        f"LEFT JOIN templates t ON t.id=d.template_id WHERE {where} "
        "ORDER BY CASE d.state WHEN 'ambiguous' THEN 0 WHEN 'needs_review' THEN 1 ELSE 2 END, d.updated_at DESC,d.id DESC LIMIT ? OFFSET ?",
        tuple(parameters),
    )
    for item in items:
        item["safety_flags"] = parse_flags(item["safety_flags"])
        item["content_hash"] = hashlib.sha256(
            (item["subject"] + "\n" + item["body"]).encode()
        ).hexdigest()
    return {"items": items, "total": total["count"], "limit": limit, "offset": offset}


def suppression_key(provider: str, source_url: str) -> str:
    return f"{provider}:{validate_provider_url(source_url)}".lower()


def persist_intake_restriction(connection, member, prospect_id, provider, source_url, status):
    connection.execute(
        "INSERT OR IGNORE INTO suppressions(workspace_id,prospect_id,normalized_value,reason,created_by,created_at) VALUES (?,?,?,?,?,?)",
        (
            member["workspace_id"],
            prospect_id,
            suppression_key(provider, source_url),
            f"Restricted during intake: {status}",
            member["user_id"],
            now(),
        ),
    )
    connection.execute(
        "UPDATE prospects SET consent_status=?,updated_at=? WHERE id=?",
        (status, now(), prospect_id),
    )
    connection.execute(
        "UPDATE drafts SET state='suppressed',updated_at=? WHERE prospect_id=? AND state NOT IN ('replied','suppressed')",
        (now(), prospect_id),
    )
    connection.execute(
        "UPDATE reminders SET status='cancelled' WHERE status='open' AND (prospect_id=? OR draft_id IN (SELECT id FROM drafts WHERE prospect_id=?))",
        (prospect_id, prospect_id),
    )


def approved_provider_url(connection, workspace_id, prospect):
    provider = connection.execute(
        "SELECT * FROM provider_settings WHERE workspace_id=? AND provider=?",
        (workspace_id, prospect["provider"]),
    ).fetchone()
    if not provider:
        raise AppError(409, "provider_not_configured", "Configure an approved provider link first")
    try:
        allowed_host = {validate_provider_url(provider["base_url"]).split("/")[2].lower()}
        return validate_provider_url(prospect["source_url"], allowed_host)
    except ValueError as exc:
        raise AppError(
            409, "provider_not_approved", "The current provider link is not approved"
        ) from exc


def is_suppressed(connection, workspace_id: int, provider: str, source_url: str) -> bool:
    key = suppression_key(provider, source_url)
    # Historical entries used uncanonicalized URLs. Preserve those opt-outs too.
    for row in connection.execute(
        "SELECT normalized_value FROM suppressions WHERE workspace_id=?",
        (workspace_id,),
    ):
        stored_provider, _, stored_url = row["normalized_value"].partition(":")
        try:
            if suppression_key(stored_provider, stored_url) == key:
                return True
        except ValueError:
            if row["normalized_value"] == key:
                return True
    return False


def require_contactable(connection, prospect):
    if prospect["consent_status"] in {"opted_out", "blocked"} or is_suppressed(
        connection, prospect["workspace_id"], prospect["provider"], prospect["source_url"]
    ):
        raise AppError(409, "prospect_suppressed", "This prospect cannot receive outreach")


@app.post("/api/drafts", status_code=201)
def create_draft(body: DraftBody, member: Member):
    require_role(member, "owner", "admin", "editor")
    with transaction() as connection:
        campaign = owned(connection, "campaigns", body.campaign_id, member["workspace_id"])
        prospect = owned(connection, "prospects", body.prospect_id, member["workspace_id"])
        template = owned(connection, "templates", body.template_id, member["workspace_id"])
        require_contactable(connection, prospect)
        try:
            rendered = render_template(
                template["body"],
                {
                    "name": prospect["name"],
                    "organization": prospect["organization"],
                    "campaign": campaign["name"],
                    "notes": prospect["notes"],
                },
            )
        except DomainError as exc:
            raise AppError(422, "template_render_failed", str(exc)) from exc
        score, flags = assess_message(rendered, prospect)
        timestamp = now()
        record_id = connection.execute(
            "INSERT INTO drafts(workspace_id,campaign_id,prospect_id,template_id,subject,body,quality_score,"
            "safety_flags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                member["workspace_id"],
                body.campaign_id,
                body.prospect_id,
                body.template_id,
                template["subject"],
                rendered,
                score,
                json.dumps(flags),
                timestamp,
                timestamp,
            ),
        ).lastrowid
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "draft.created",
            "draft",
            record_id,
            {"quality_score": score, "flags": flags},
        )
    return {"id": record_id, "state": "needs_review", "quality_score": score, "safety_flags": flags}


@app.patch("/api/drafts/{draft_id}")
def edit_draft(draft_id: int, body: DraftEditBody, member: Member):
    require_role(member, "owner", "admin", "editor")
    with transaction() as connection:
        draft = owned(connection, "drafts", draft_id, member["workspace_id"])
        if draft["state"] not in {"needs_review", "approved"}:
            raise AppError(409, "draft_locked", "This draft can no longer be edited")
        prospect = dict(
            connection.execute(
                "SELECT * FROM prospects WHERE id=?", (draft["prospect_id"],)
            ).fetchone()
        )
        score, flags = assess_message(body.body, prospect)
        target = "needs_review"
        connection.execute(
            "UPDATE drafts SET subject=?,body=?,state=?,quality_score=?,safety_flags=?,reviewed_by=NULL,"
            "approved_at=NULL,updated_at=? WHERE id=?",
            (body.subject, body.body, target, score, json.dumps(flags), now(), draft_id),
        )
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "draft.edited",
            "draft",
            draft_id,
            {"quality_score": score, "flags": flags},
        )
    return {"state": target, "quality_score": score, "safety_flags": flags}


@app.post("/api/drafts/{draft_id}/review")
def review_draft(draft_id: int, body: ReviewBody, member: Member):
    require_role(member, "owner", "admin", "editor")
    target = "approved" if body.decision == "approve" else "declined"
    with transaction() as connection:
        draft = owned(connection, "drafts", draft_id, member["workspace_id"])
        try:
            require_transition(draft["state"], target)
        except DomainError as exc:
            raise AppError(409, "invalid_state", str(exc)) from exc
        if target == "approved":
            if not member["compliance_ack_at"]:
                raise AppError(
                    409,
                    "compliance_required",
                    "Complete the compliance review before approving outreach",
                )
            if member["paused_at"]:
                raise AppError(409, "workspace_paused", "Outreach is paused by the safety stop")
            missing = APPROVAL_CHECKS - set(body.acknowledged_checks)
            if missing:
                raise AppError(
                    422,
                    "approval_checks_missing",
                    "Complete every pre-action safety check",
                    sorted(missing),
                )
            prospect = dict(
                connection.execute(
                    "SELECT * FROM prospects WHERE id=?", (draft["prospect_id"],)
                ).fetchone()
            )
            require_contactable(connection, prospect)
            expected = hashlib.sha256(
                (draft["subject"] + "\n" + draft["body"]).encode()
            ).hexdigest()
            if body.expected_content_hash != expected:
                raise AppError(
                    409,
                    "draft_changed",
                    "Reload and review the current saved message before approving",
                )
        timestamp = now()
        connection.execute(
            "UPDATE drafts SET state=?,reviewed_by=?,approved_at=?,updated_at=? WHERE id=?",
            (
                target,
                member["user_id"],
                timestamp if target == "approved" else None,
                timestamp,
                draft_id,
            ),
        )
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            f"draft.{target}",
            "draft",
            draft_id,
            {"checks": body.acknowledged_checks},
        )
    return {"state": target}


@app.post("/api/drafts/{draft_id}/handoff")
def prepare_handoff(
    draft_id: int,
    member: Member,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
):
    require_role(member, "owner", "admin", "editor")
    if settings.demo_mode:
        raise AppError(409, "demo_external_blocked", "External handoffs are disabled in demo mode")
    if not idempotency_key or not 12 <= len(idempotency_key) <= 120:
        raise AppError(
            400, "idempotency_required", "Provide a unique Idempotency-Key for this handoff"
        )
    with transaction() as connection:
        existing = connection.execute(
            "SELECT * FROM handoffs WHERE workspace_id=? AND idempotency_key=?",
            (member["workspace_id"], idempotency_key),
        ).fetchone()
        draft = owned(connection, "drafts", draft_id, member["workspace_id"])
        if existing and existing["draft_id"] != draft_id:
            raise AppError(409, "idempotency_conflict", "This handoff key belongs to another draft")
        if not existing and draft["state"] != "approved":
            raise AppError(
                409, "approval_required", "Approve the current draft before preparing a handoff"
            )
        workspace = dict(
            connection.execute(
                "SELECT * FROM workspaces WHERE id=?", (member["workspace_id"],)
            ).fetchone()
        )
        if workspace["paused_at"]:
            raise AppError(409, "workspace_paused", "Outreach is paused by the safety stop")
        prospect = dict(
            connection.execute(
                "SELECT * FROM prospects WHERE id=?", (draft["prospect_id"],)
            ).fetchone()
        )
        campaign = dict(
            connection.execute(
                "SELECT * FROM campaigns WHERE id=?", (draft["campaign_id"],)
            ).fetchone()
        )
        if campaign["status"] != "active":
            raise AppError(
                409, "campaign_inactive", "Activate the campaign before preparing a handoff"
            )
        require_contactable(connection, prospect)
        provider_url = approved_provider_url(connection, member["workspace_id"], prospect)
        content_hash = hashlib.sha256(
            (draft["subject"] + "\n" + draft["body"]).encode()
        ).hexdigest()
        if existing:
            latest = connection.execute(
                "SELECT id FROM handoffs WHERE draft_id=? ORDER BY id DESC LIMIT 1", (draft_id,)
            ).fetchone()
            if (
                existing["status"] not in {"prepared", "opened", "ambiguous"}
                or draft["state"] not in {"handoff_created", "ambiguous"}
                or latest["id"] != existing["id"]
                or existing["content_hash"] != content_hash
                or validate_provider_url(existing["provider_url"]) != provider_url
            ):
                raise AppError(409, "handoff_stale", "This handoff is no longer actionable")
            return dict(existing) | {
                "subject": draft["subject"],
                "body": draft["body"],
                "replayed": True,
                "can_open_provider": True,
                "instruction": "Copy the message, open the provider, send manually, then record the outcome.",
            }
        today = datetime.now(UTC).date().isoformat()
        daily = connection.execute(
            "SELECT COUNT(*) AS count FROM handoffs h JOIN drafts d ON d.id=h.draft_id "
            "WHERE d.campaign_id=? AND substr(h.prepared_at,1,10)=?",
            (campaign["id"], today),
        ).fetchone()["count"]
        if daily >= campaign["daily_limit"]:
            raise AppError(
                429, "daily_limit_reached", "This campaign reached its daily handoff limit"
            )
        last = connection.execute(
            "SELECT prepared_at FROM handoffs h JOIN drafts d ON d.id=h.draft_id "
            "WHERE d.prospect_id=? ORDER BY prepared_at DESC LIMIT 1",
            (prospect["id"],),
        ).fetchone()
        if last:
            next_allowed = datetime.fromisoformat(last["prepared_at"]) + timedelta(
                minutes=campaign["cooldown_minutes"]
            )
            if next_allowed > datetime.now(UTC):
                raise AppError(
                    429,
                    "cooldown_active",
                    f"This prospect is in cooldown until {next_allowed.isoformat()}",
                )
        timestamp = now()
        handoff_id = connection.execute(
            "INSERT INTO handoffs(workspace_id,draft_id,idempotency_key,provider_url,content_hash,prepared_at) VALUES (?,?,?,?,?,?)",
            (
                member["workspace_id"],
                draft_id,
                idempotency_key,
                provider_url,
                content_hash,
                timestamp,
            ),
        ).lastrowid
        connection.execute(
            "UPDATE drafts SET state='handoff_created',updated_at=? WHERE id=?",
            (timestamp, draft_id),
        )
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "handoff.prepared",
            "handoff",
            handoff_id,
            {"draft_id": draft_id, "content_hash": content_hash},
        )
    return {
        "id": handoff_id,
        "draft_id": draft_id,
        "provider_url": provider_url,
        "subject": draft["subject"],
        "body": draft["body"],
        "status": "prepared",
        "replayed": False,
        "can_open_provider": True,
        "instruction": "Copy the message, open the provider, send manually, then record the outcome.",
    }


@app.post("/api/handoffs/{handoff_id}/outcome")
def record_handoff_outcome(handoff_id: int, body: HandoffOutcomeBody, member: Member):
    require_role(member, "owner", "admin", "editor")
    draft_state = {"sent": "sent", "ambiguous": "ambiguous", "cancelled": "approved"}[body.outcome]
    with transaction() as connection:
        handoff = owned(connection, "handoffs", handoff_id, member["workspace_id"])
        if handoff["status"] not in {"prepared", "opened", "ambiguous"}:
            raise AppError(409, "outcome_recorded", "This handoff already has a final outcome")
        draft = owned(connection, "drafts", handoff["draft_id"], member["workspace_id"])
        latest = connection.execute(
            "SELECT id FROM handoffs WHERE draft_id=? ORDER BY id DESC LIMIT 1", (draft["id"],)
        ).fetchone()
        if draft["state"] not in {"handoff_created", "ambiguous"} or latest["id"] != handoff_id:
            raise AppError(409, "handoff_stale", "A newer draft state supersedes this handoff")
        prospect = owned(connection, "prospects", draft["prospect_id"], member["workspace_id"])
        require_contactable(connection, prospect)
        timestamp = now()
        connection.execute(
            "UPDATE handoffs SET status=?,completed_at=? WHERE id=?",
            (body.outcome, timestamp, handoff_id),
        )
        connection.execute(
            "UPDATE drafts SET state=?,sent_at=?,updated_at=? WHERE id=?",
            (
                draft_state,
                timestamp if draft_state == "sent" else None,
                timestamp,
                handoff["draft_id"],
            ),
        )
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            f"handoff.{body.outcome}",
            "handoff",
            handoff_id,
            {"draft_id": handoff["draft_id"]},
        )
    return {"status": body.outcome, "draft_state": draft_state}


@app.get("/api/handoffs")
def list_handoffs(
    member: Member,
    draft_id: int | None = Query(None, ge=1),
    limit: int = Query(25, ge=1, le=100),
):
    parameters: list[Any] = [member["workspace_id"]]
    where = "h.workspace_id=?"
    if draft_id is not None:
        where += " AND h.draft_id=?"
        parameters.append(draft_id)
    parameters.append(limit)
    with transaction() as connection:
        items = [
            dict(row)
            for row in connection.execute(
                f"SELECT h.*,d.subject,d.body,p.name AS prospect_name "
                f"FROM handoffs h JOIN drafts d ON d.id=h.draft_id "
                f"JOIN prospects p ON p.id=d.prospect_id WHERE {where} "
                "ORDER BY h.id DESC LIMIT ?",
                tuple(parameters),
            )
        ]
        workspace = connection.execute(
            "SELECT * FROM workspaces WHERE id=?", (member["workspace_id"],)
        ).fetchone()
        for item in items:
            item["can_open_provider"] = False
            draft = owned(connection, "drafts", item["draft_id"], member["workspace_id"])
            prospect = owned(connection, "prospects", draft["prospect_id"], member["workspace_id"])
            campaign = owned(connection, "campaigns", draft["campaign_id"], member["workspace_id"])
            latest = connection.execute(
                "SELECT id FROM handoffs WHERE draft_id=? ORDER BY id DESC LIMIT 1", (draft["id"],)
            ).fetchone()
            if (
                settings.demo_mode
                or member["role"] not in {"owner", "admin", "editor"}
                or workspace["paused_at"]
                or not workspace["compliance_ack_at"]
                or campaign["status"] != "active"
                or draft["state"] not in {"handoff_created", "ambiguous"}
                or item["status"] not in {"prepared", "opened", "ambiguous"}
                or latest["id"] != item["id"]
                or item["content_hash"]
                != hashlib.sha256((draft["subject"] + "\n" + draft["body"]).encode()).hexdigest()
            ):
                continue
            try:
                require_contactable(connection, prospect)
                item["can_open_provider"] = validate_provider_url(
                    item["provider_url"]
                ) == approved_provider_url(connection, member["workspace_id"], prospect)
            except (AppError, ValueError):
                pass
    return {"items": items}


@app.get("/api/replies")
def list_replies(
    member: Member, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)
):
    return {
        "items": fetch_all(
            "SELECT r.*,p.name AS prospect_name,c.name AS campaign_name FROM replies r "
            "JOIN drafts d ON d.id=r.draft_id JOIN prospects p ON p.id=d.prospect_id "
            "JOIN campaigns c ON c.id=d.campaign_id WHERE r.workspace_id=? ORDER BY r.received_at DESC,r.id DESC LIMIT ? OFFSET ?",
            (member["workspace_id"], limit, offset),
        ),
        "total": fetch_one(
            "SELECT COUNT(*) AS count FROM replies WHERE workspace_id=?", (member["workspace_id"],)
        )["count"],
        "limit": limit,
        "offset": offset,
    }


@app.post("/api/replies", status_code=201)
def create_reply(body: ReplyBody, member: Member):
    require_role(member, "owner", "admin", "editor")
    with transaction() as connection:
        draft = owned(connection, "drafts", body.draft_id, member["workspace_id"])
        if draft["state"] not in {"sent", "handoff_created", "ambiguous"}:
            raise AppError(
                409,
                "reply_not_expected",
                "Record a send or ambiguous handoff before adding a reply",
            )
        timestamp = body.received_at or now()
        record_id = connection.execute(
            "INSERT INTO replies(workspace_id,draft_id,body,received_at,created_by,created_at) VALUES (?,?,?,?,?,?)",
            (member["workspace_id"], body.draft_id, body.body, timestamp, member["user_id"], now()),
        ).lastrowid
        connection.execute(
            "UPDATE drafts SET state='replied',updated_at=? WHERE id=?", (now(), body.draft_id)
        )
        connection.execute(
            "UPDATE reminders SET status='cancelled' WHERE draft_id=? AND status='open'",
            (body.draft_id,),
        )
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "reply.recorded",
            "reply",
            record_id,
            {"draft_id": body.draft_id},
        )
    return {"id": record_id, "state": "replied"}


@app.get("/api/reminders")
def list_reminders(
    member: Member,
    status: str = Query("open", max_length=20),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    return {
        "items": fetch_all(
            "SELECT r.*,p.name AS prospect_name,c.name AS campaign_name FROM reminders r "
            "LEFT JOIN drafts d ON d.id=r.draft_id LEFT JOIN prospects p ON p.id=COALESCE(r.prospect_id,d.prospect_id) "
            "LEFT JOIN campaigns c ON c.id=d.campaign_id WHERE r.workspace_id=? AND r.status=? ORDER BY r.due_at,r.id LIMIT ? OFFSET ?",
            (member["workspace_id"], status, limit, offset),
        ),
        "total": fetch_one(
            "SELECT COUNT(*) AS count FROM reminders WHERE workspace_id=? AND status=?",
            (member["workspace_id"], status),
        )["count"],
        "limit": limit,
        "offset": offset,
    }


@app.post("/api/reminders", status_code=201)
def create_reminder(body: ReminderBody, member: Member):
    require_role(member, "owner", "admin", "editor")
    if not body.draft_id and not body.prospect_id:
        raise AppError(422, "target_required", "Choose a draft or prospect for the reminder")
    with transaction() as connection:
        if body.draft_id:
            owned(connection, "drafts", body.draft_id, member["workspace_id"])
        if body.prospect_id:
            owned(connection, "prospects", body.prospect_id, member["workspace_id"])
        record_id = connection.execute(
            "INSERT INTO reminders(workspace_id,draft_id,prospect_id,title,due_at,created_by,created_at) VALUES (?,?,?,?,?,'user',?)",
            (
                member["workspace_id"],
                body.draft_id,
                body.prospect_id,
                body.title,
                body.due_at,
                now(),
            ),
        ).lastrowid
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "reminder.created",
            "reminder",
            record_id,
        )
    return {"id": record_id, "status": "open"}


@app.patch("/api/reminders/{reminder_id}")
def update_reminder(reminder_id: int, body: ReminderStatusBody, member: Member):
    require_role(member, "owner", "admin", "editor")
    with transaction() as connection:
        owned(connection, "reminders", reminder_id, member["workspace_id"])
        connection.execute("UPDATE reminders SET status=? WHERE id=?", (body.status, reminder_id))
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            f"reminder.{body.status}",
            "reminder",
            reminder_id,
        )
    return {"status": body.status}


@app.post("/api/suppressions", status_code=201)
def suppress_prospect(body: SuppressionBody, member: Member):
    require_role(member, "owner", "admin", "editor")
    with transaction() as connection:
        prospect = owned(connection, "prospects", body.prospect_id, member["workspace_id"])
        value = suppression_key(prospect["provider"], prospect["source_url"])
        connection.execute(
            "INSERT OR IGNORE INTO suppressions(workspace_id,prospect_id,normalized_value,reason,created_by,created_at) VALUES (?,?,?,?,?,?)",
            (
                member["workspace_id"],
                body.prospect_id,
                value,
                body.reason,
                member["user_id"],
                now(),
            ),
        )
        connection.execute(
            "UPDATE prospects SET consent_status='opted_out',updated_at=? WHERE id=?",
            (now(), body.prospect_id),
        )
        connection.execute(
            "UPDATE drafts SET state='suppressed',updated_at=? WHERE prospect_id=? AND state NOT IN ('replied','suppressed')",
            (now(), body.prospect_id),
        )
        connection.execute(
            "UPDATE handoffs SET status='cancelled',completed_at=? WHERE draft_id IN "
            "(SELECT id FROM drafts WHERE prospect_id=?) AND status IN ('prepared','opened','ambiguous')",
            (now(), body.prospect_id),
        )
        connection.execute(
            "UPDATE reminders SET status='cancelled' WHERE status='open' AND "
            "(prospect_id=? OR draft_id IN (SELECT id FROM drafts WHERE prospect_id=?))",
            (body.prospect_id, body.prospect_id),
        )
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "prospect.suppressed",
            "prospect",
            body.prospect_id,
            {"reason": body.reason},
        )
    return {"status": "suppressed"}


@app.get("/api/audit")
def list_audit(member: Member, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    return {
        "items": fetch_all(
            "SELECT a.*,u.display_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id "
            "WHERE a.workspace_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?",
            (member["workspace_id"], limit, offset),
        ),
        "total": fetch_one(
            "SELECT COUNT(*) AS count FROM audit_events WHERE workspace_id=?",
            (member["workspace_id"],),
        )["count"],
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/reports/summary")
def report_summary(member: Member):
    workspace_id = member["workspace_id"]
    funnel = fetch_one(
        "SELECT COUNT(*) AS total, SUM(state='needs_review') AS needs_review, SUM(state='approved') AS approved, "
        "SUM(state='handoff_created') AS prepared, SUM(state='sent') AS sent, SUM(state='replied') AS replied, "
        "SUM(state='suppressed') AS suppressed FROM drafts WHERE workspace_id=?",
        (workspace_id,),
    )
    campaigns = fetch_all(
        "SELECT c.id,c.name,c.status,COUNT(d.id) AS drafts,SUM(d.state='sent') AS sent,SUM(d.state='replied') AS replied,"
        "ROUND(AVG(d.quality_score),1) AS average_quality FROM campaigns c LEFT JOIN drafts d ON d.campaign_id=c.id "
        "WHERE c.workspace_id=? GROUP BY c.id ORDER BY c.name",
        (workspace_id,),
    )
    return {"funnel": funnel, "campaigns": campaigns, "generated_at": now(), "local_only": True}


@app.get("/api/settings")
def get_settings(member: Member):
    workspace = fetch_one("SELECT * FROM workspaces WHERE id=?", (member["workspace_id"],))
    providers = fetch_all(
        "SELECT * FROM provider_settings WHERE workspace_id=?", (member["workspace_id"],)
    )
    members = fetch_all(
        "SELECT u.id,u.email,u.display_name,m.role,u.created_at FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY u.display_name",
        (member["workspace_id"],),
    )
    return {
        "workspace": workspace,
        "providers": providers,
        "members": members,
        "environment": settings.environment,
        "demo_mode": settings.demo_mode,
    }


@app.post("/api/settings/compliance")
def acknowledge_compliance(body: ComplianceBody, member: Member):
    require_role(member, "owner", "admin")
    if not all(body.model_dump().values()):
        raise AppError(422, "compliance_incomplete", "Confirm every compliance statement")
    timestamp = now()
    with transaction() as connection:
        connection.execute(
            "UPDATE workspaces SET compliance_ack_at=?,compliance_ack_by=? WHERE id=?",
            (timestamp, member["user_id"], member["workspace_id"]),
        )
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "compliance.acknowledged",
            "workspace",
            member["workspace_id"],
            body.model_dump(),
        )
    return {"compliance_ack_at": timestamp}


@app.post("/api/settings/provider")
def update_provider(body: ProviderBody, member: Member):
    require_role(member, "owner", "admin")
    try:
        url = validate_provider_url(body.base_url)
    except ValueError as exc:
        raise AppError(422, "invalid_provider_url", str(exc)) from exc
    with transaction() as connection:
        connection.execute(
            "INSERT INTO provider_settings(workspace_id,provider,base_url,mode,updated_at) VALUES (?,?,?,'assisted',?) "
            "ON CONFLICT(workspace_id,provider) DO UPDATE SET base_url=excluded.base_url,verified_at=NULL,updated_at=excluded.updated_at",
            (member["workspace_id"], body.provider.lower(), url, now()),
        )
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "provider.updated",
            "provider",
            body.provider.lower(),
            {"base_url": url, "mode": "assisted"},
        )
    return {
        "provider": body.provider.lower(),
        "base_url": url,
        "mode": "assisted",
        "verified": False,
    }


@app.post("/api/settings/pause")
def set_pause(body: PauseBody, member: Member):
    require_role(member, "owner", "admin")
    timestamp = now() if body.paused else None
    with transaction() as connection:
        connection.execute(
            "UPDATE workspaces SET paused_at=?,paused_by=? WHERE id=?",
            (timestamp, member["user_id"] if body.paused else None, member["workspace_id"]),
        )
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "safety.paused" if body.paused else "safety.resumed",
            "workspace",
            member["workspace_id"],
        )
    return {"paused": body.paused, "paused_at": timestamp}


@app.post("/api/settings/team", status_code=201)
def add_team_member(body: TeamMemberBody, member: Member):
    require_role(member, "owner", "admin")
    try:
        email = validate_email(body.email)
        password = hash_password(body.password)
    except ValueError as exc:
        raise AppError(422, "validation_failed", str(exc)) from exc
    with transaction() as connection:
        timestamp = now()
        user_id = connection.execute(
            "INSERT INTO users(email,password_hash,display_name,created_at) VALUES (?,?,?,?)",
            (email, password, body.display_name, timestamp),
        ).lastrowid
        connection.execute(
            "INSERT INTO memberships(user_id,workspace_id,role) VALUES (?,?,?)",
            (user_id, member["workspace_id"], body.role),
        )
        audit(
            connection,
            member["workspace_id"],
            member["user_id"],
            "team.member_added",
            "user",
            user_id,
            {"role": body.role},
        )
    return {"id": user_id, "email": email, "role": body.role}


@app.get("/api/export")
def export_workspace(member: Member):
    require_role(member, "owner", "admin")
    workspace_id = member["workspace_id"]
    tables = [
        "campaigns",
        "prospects",
        "templates",
        "drafts",
        "handoffs",
        "replies",
        "reminders",
        "suppressions",
        "audit_events",
    ]
    payload: dict[str, Any] = {
        "exported_at": now(),
        "workspace_id": workspace_id,
        "schema_version": 1,
    }
    for table in tables:
        payload[table] = fetch_all(f"SELECT * FROM {table} WHERE workspace_id=?", (workspace_id,))
    return payload


@app.get("/api/support-bundle")
def support_bundle(member: Member):
    require_role(member, "owner", "admin")
    migrations = fetch_all("SELECT * FROM schema_migrations ORDER BY name")
    counts = {}
    for table in (
        "campaigns",
        "prospects",
        "templates",
        "drafts",
        "handoffs",
        "replies",
        "reminders",
        "audit_events",
    ):
        counts[table] = fetch_one(
            f"SELECT COUNT(*) AS count FROM {table} WHERE workspace_id=?", (member["workspace_id"],)
        )["count"]
    return {
        "generated_at": now(),
        "environment": settings.environment,
        "demo_mode": settings.demo_mode,
        "database_bytes": database_size(),
        "migrations": migrations,
        "record_counts": counts,
        "latest_events": fetch_all(
            "SELECT event_type,entity_type,created_at FROM audit_events WHERE workspace_id=? ORDER BY created_at DESC LIMIT 25",
            (member["workspace_id"],),
        ),
        "redaction": "No message bodies, names, emails, tokens, credentials, or provider handles are included.",
    }


frontend_dist = ROOT / "frontend" / "dist"
if frontend_dist.exists():
    assets = frontend_dist / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        requested = (frontend_dist / path).resolve()
        if requested.is_file() and frontend_dist.resolve() in requested.parents:
            return FileResponse(requested)
        return FileResponse(frontend_dist / "index.html")
