"""Detect drift between Alembic migration head and SQLAlchemy model state."""
from __future__ import annotations
import shutil
import subprocess
from pathlib import Path


def check(repo: Path) -> dict:
    if not (repo / "alembic.ini").exists():
        return {"drift": None, "detail": "alembic.ini not found — skip", "heads": []}
    if not shutil.which("alembic"):
        return {"drift": None, "detail": "alembic not on PATH — skip", "heads": []}
    try:
        r = subprocess.run(["alembic", "check"], cwd=str(repo),
                           capture_output=True, text=True, timeout=30, check=False)
        out = (r.stdout + r.stderr).strip()
        if r.returncode == 0:
            return {"drift": False, "detail": out or "alembic check: OK", "heads": []}
        return {"drift": True, "detail": out[:500], "heads": []}
    except Exception as exc:
        return {"drift": None, "detail": f"alembic check failed: {exc}", "heads": []}
