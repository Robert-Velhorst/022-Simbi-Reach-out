"""Offline recovery for the owner's personal local installation."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from . import db
from .security import hash_password, validate_email


def recover_owner_password(email: str, passphrase: str) -> Path:
    if db.settings.environment not in {"local", "test"}:
        raise ValueError("Owner recovery requires a local personal installation")
    email = validate_email(email)
    if not 12 <= len(passphrase) <= 200:
        raise ValueError("Password must contain between 12 and 200 characters")
    encoded = hash_password(passphrase)
    target = db.settings.database_path.resolve()
    if not target.is_file():
        raise ValueError("No existing database at this path; check the installation settings")
    with db.file_lock(Path(str(target) + ".runtime.lock")):
        # Do not create or upgrade a database during forgotten-password recovery.
        with closing(
            sqlite3.connect(target.as_uri() + "?mode=rw", uri=True, timeout=0)
        ) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA trusted_schema=OFF")
            db._validate_schema(connection)
            if connection.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0] != 1:
                raise ValueError("Recovery requires one personal workspace")
            owner = connection.execute(
                "SELECT u.id,m.workspace_id FROM users u JOIN memberships m ON m.user_id=u.id "
                "WHERE u.email=? AND m.role='owner'",
                (email,),
            ).fetchone()
            if not owner:
                raise ValueError("That email is not the existing personal workspace owner")
            safety_backup = db._snapshot(connection, db.settings.backup_path)
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    "UPDATE users SET password_hash=? WHERE id=?", (encoded, owner["id"])
                )
                connection.execute("DELETE FROM sessions WHERE user_id=?", (owner["id"],))
                db.audit(
                    connection,
                    owner["workspace_id"],
                    None,
                    "account.owner_password_recovered",
                    "user",
                    owner["id"],
                    {"method": "offline_local"},
                )
    return safety_backup
