from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
from urllib.parse import urlparse

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def hash_password(password: str) -> str:
    if len(password) < 12:
        raise ValueError("Password must contain at least 12 characters")
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, salt_value, digest_value = encoded.split("$", 2)
        if algorithm != "scrypt":
            return False
        salt = base64.b64decode(salt_value)
        expected = base64.b64decode(digest_value)
        actual = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def session_token() -> str:
    return secrets.token_urlsafe(32)


def csrf_token() -> str:
    return secrets.token_urlsafe(24)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def validate_email(email: str) -> str:
    value = email.strip().lower()
    if len(value) > 254 or not EMAIL_RE.match(value):
        raise ValueError("Enter a valid email address")
    return value


def clean_text(value: str, field: str, maximum: int, minimum: int = 0) -> str:
    text = " ".join(value.replace("\x00", "").split())
    if not minimum <= len(text) <= maximum:
        raise ValueError(f"{field} must contain between {minimum} and {maximum} characters")
    return text


def validate_provider_url(value: str, allowed_hosts: set[str] | None = None) -> str:
    if "\\" in value or any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("Provider links cannot contain backslashes or control characters")
    url = value.strip()
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Provider links must be HTTPS URLs without embedded credentials")
    if parsed.port not in {None, 443}:
        raise ValueError("Provider links may only use the standard HTTPS port")
    if allowed_hosts and parsed.hostname.lower() not in allowed_hosts:
        raise ValueError("Provider link host is not approved for this workspace")
    return parsed._replace(netloc=parsed.hostname.lower(), fragment="").geturl()
