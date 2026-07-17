"""Shared helpers for Gates 9–14. No external deps required."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

SEVERITY_CRITICAL = "critical"
SEVERITY_HIGH = "high"
SEVERITY_MEDIUM = "medium"
SEVERITY_LOW = "low"

CONF_HIGH = "high"
CONF_MEDIUM = "medium"
CONF_LOW = "low"

AUTH_BLOCKER = "blocker"
AUTH_ADAPT = "adapt"
AUTH_TECH_DEBT = "tech_debt"


def finding(
    gate_id: int,
    gate_name: str,
    cls: str,
    subclass: str,
    severity: str,
    confidence: str,
    authority_action: str | None,
    evidence: dict[str, Any],
    why_not_autofixable: str | None,
    remediation: dict[str, Any],
    autofix_plan: dict[str, Any] | None = None,
    adapted_artifact_path: str | None = None,
) -> dict[str, Any]:
    """Canonical finding shape — matches semantic-gate-artifact.schema.json."""
    safe_cls = cls.split()[0].replace("/", "-")
    fid = f"BLK-{gate_id}-{safe_cls}"
    return {
        "id": fid,
        "gate": gate_id,
        "gate_name": gate_name,
        "class": cls,
        "subclass": subclass,
        "severity": severity,
        "confidence": confidence,
        "authority_action": authority_action,
        "evidence": evidence,
        "why_not_autofixable": why_not_autofixable,
        "remediation": remediation,
        "autofix_applied": False,
        "autofix_plan": autofix_plan,
        "adapted_artifact_path": adapted_artifact_path,
    }


def remediation(owner: str, steps: list[str], commands: list[str] = (), auto_option: str | None = None) -> dict[str, Any]:
    return {"owner": owner, "steps": list(steps), "commands": list(commands), "auto_option": auto_option}


def iter_text_files(repo: Path):
    """Yield (path, rel_str, lines) for every trackable text file."""
    _SKIP = {".git", "node_modules", ".venv", "__pycache__", ".pytest_cache",
              ".mypy_cache", ".ruff_cache", "dist", "build", ".preflight",
              ".next", ".turbo", "coverage", "htmlcov"}
    _EXT = {".py", ".ts", ".tsx", ".js", ".jsx", ".sh", ".yml", ".yaml",
             ".toml", ".json", ".md", ".cfg", ".ini", ".txt", ".env"}
    for p in sorted(repo.rglob("*")):
        if not p.is_file():
            continue
        if any(seg in _SKIP for seg in p.relative_to(repo).parts):
            continue
        if p.suffix in _EXT or p.name.startswith(".env"):
            try:
                yield p, str(p.relative_to(repo)), p.read_text(encoding="utf-8", errors="ignore").splitlines()
            except Exception:
                continue
