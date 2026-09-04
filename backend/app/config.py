from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))


def _runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        local_app_data = os.getenv("LOCALAPPDATA")
        if not local_app_data:
            raise RuntimeError("LOCALAPPDATA is required by the Windows standalone app")
        return Path(local_app_data) / "Simbi Reach-Out"
    return ROOT


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    if value.lower() not in {"true", "false", "1", "0"}:
        raise RuntimeError(f"{name} must be true or false")
    return value.lower() in {"true", "1"}


def _int(name: str, default: int, minimum: int, maximum: int) -> int:
    value = int(os.getenv(name, str(default)))
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def _list(name: str, default: str) -> tuple[str, ...]:
    values = tuple(
        item.strip().lower() for item in os.getenv(name, default).split(",") if item.strip()
    )
    if not values:
        raise RuntimeError(f"{name} must contain at least one value")
    return values


@dataclass(frozen=True)
class Settings:
    environment: str
    database_path: Path
    frontend_origin: str
    session_hours: int
    cookie_secure: bool
    retention_days: int
    max_import_bytes: int
    allowed_hosts: tuple[str, ...]
    forwarded_allow_ips: str
    max_failed_logins: int
    login_window_minutes: int
    login_lock_minutes: int
    auto_backup: bool
    backup_path: Path
    backup_retention_days: int
    hai_feed_path: Path | None
    hai_include_content: bool
    setup_token: str = ""
    require_maintenance: bool = False

    @property
    def demo_mode(self) -> bool:
        return self.environment == "demo"


def load_settings() -> Settings:
    environment = os.getenv("SIMBI_ENV", "local").lower()
    if environment not in {"local", "test", "demo", "production"}:
        raise RuntimeError("SIMBI_ENV must be local, test, demo, or production")
    runtime_root = _runtime_root()
    database_path = Path(os.getenv("SIMBI_DATABASE_PATH", str(runtime_root / "data" / "simbi.db")))
    origin = os.getenv("SIMBI_FRONTEND_ORIGIN", "http://localhost:5173").rstrip("/")
    if environment == "production" and not origin.startswith("https://"):
        raise RuntimeError("Production requires an HTTPS SIMBI_FRONTEND_ORIGIN")
    cookie_secure = _bool("SIMBI_COOKIE_SECURE", environment == "production")
    if environment == "production" and not cookie_secure:
        raise RuntimeError("Production requires SIMBI_COOKIE_SECURE=true")
    default_hosts = "localhost,127.0.0.1,testserver" if environment != "production" else ""
    allowed_hosts = _list("SIMBI_ALLOWED_HOSTS", default_hosts)
    origin_host = (urlparse(origin).hostname or "").lower()
    if environment == "production":
        if "*" in allowed_hosts or any(
            host in {"localhost", "127.0.0.1", "::1"} for host in allowed_hosts
        ):
            raise RuntimeError(
                "Production SIMBI_ALLOWED_HOSTS must contain explicit public hostnames"
            )
        if origin_host not in allowed_hosts:
            raise RuntimeError(
                "Production frontend origin host must be present in SIMBI_ALLOWED_HOSTS"
            )
    forwarded_allow_ips = os.getenv("SIMBI_FORWARDED_ALLOW_IPS", "127.0.0.1").strip()
    if not forwarded_allow_ips:
        raise RuntimeError("SIMBI_FORWARDED_ALLOW_IPS must not be empty")
    setup_token = os.getenv("SIMBI_SETUP_TOKEN", "")
    if setup_token and not 32 <= len(setup_token) <= 200:
        raise RuntimeError("SIMBI_SETUP_TOKEN must contain between 32 and 200 characters")
    return Settings(
        environment=environment,
        database_path=database_path,
        frontend_origin=origin,
        session_hours=_int("SIMBI_SESSION_HOURS", 12, 1, 168),
        cookie_secure=cookie_secure,
        retention_days=_int("SIMBI_RETENTION_DAYS", 365, 30, 3650),
        max_import_bytes=_int("SIMBI_MAX_IMPORT_BYTES", 1_048_576, 1_024, 10_485_760),
        allowed_hosts=allowed_hosts,
        forwarded_allow_ips=forwarded_allow_ips,
        max_failed_logins=_int("SIMBI_MAX_FAILED_LOGINS", 5, 3, 20),
        login_window_minutes=_int("SIMBI_LOGIN_WINDOW_MINUTES", 15, 1, 120),
        login_lock_minutes=_int("SIMBI_LOGIN_LOCK_MINUTES", 15, 1, 1440),
        auto_backup=_bool("SIMBI_AUTO_BACKUP", environment == "production"),
        backup_path=Path(os.getenv("SIMBI_BACKUP_PATH", str(runtime_root / "backups"))),
        backup_retention_days=_int("SIMBI_BACKUP_RETENTION_DAYS", 30, 7, 3650),
        hai_feed_path=(
            Path(value).resolve()
            if (value := os.getenv("SIMBI_HAI_FEED_PATH", "").strip())
            else None
        ),
        hai_include_content=_bool("SIMBI_HAI_INCLUDE_CONTENT", False),
        setup_token=setup_token,
        require_maintenance=_bool("SIMBI_REQUIRE_MAINTENANCE", False),
    )


settings = load_settings()
