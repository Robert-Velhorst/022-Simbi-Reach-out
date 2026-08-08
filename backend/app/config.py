from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


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


@dataclass(frozen=True)
class Settings:
    environment: str
    database_path: Path
    frontend_origin: str
    session_hours: int
    cookie_secure: bool
    retention_days: int
    max_import_bytes: int

    @property
    def demo_mode(self) -> bool:
        return self.environment == "demo"


def load_settings() -> Settings:
    environment = os.getenv("SIMBI_ENV", "local").lower()
    if environment not in {"local", "test", "demo", "production"}:
        raise RuntimeError("SIMBI_ENV must be local, test, demo, or production")
    database_path = Path(os.getenv("SIMBI_DATABASE_PATH", str(ROOT / "data" / "simbi.db")))
    origin = os.getenv("SIMBI_FRONTEND_ORIGIN", "http://localhost:5173").rstrip("/")
    if environment == "production" and not origin.startswith("https://"):
        raise RuntimeError("Production requires an HTTPS SIMBI_FRONTEND_ORIGIN")
    cookie_secure = _bool("SIMBI_COOKIE_SECURE", environment == "production")
    if environment == "production" and not cookie_secure:
        raise RuntimeError("Production requires SIMBI_COOKIE_SECURE=true")
    return Settings(
        environment=environment,
        database_path=database_path,
        frontend_origin=origin,
        session_hours=_int("SIMBI_SESSION_HOURS", 12, 1, 168),
        cookie_secure=cookie_secure,
        retention_days=_int("SIMBI_RETENTION_DAYS", 365, 30, 3650),
        max_import_bytes=_int("SIMBI_MAX_IMPORT_BYTES", 1_048_576, 1_024, 10_485_760),
    )


settings = load_settings()
