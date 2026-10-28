"""Simbi Reach-Out backend."""

from .sqlite_runtime import require_stable_sqlite

require_stable_sqlite()

__version__ = "1.0.0"
