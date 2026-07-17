"""Gate 12 — Cross-Component Misalignment (fail-open)."""
from __future__ import annotations

import ast
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from ._common import (
    AUTH_BLOCKER, AUTH_TECH_DEBT,
    CONF_HIGH, CONF_LOW, CONF_MEDIUM,
    SEVERITY_HIGH, SEVERITY_LOW, SEVERITY_MEDIUM,
    finding, remediation,
)

GATE_ID = 12
GATE_NAME = "cross-component-misalignment"
_SKIP = {".git", "node_modules", ".venv", "__pycache__", ".preflight"}
_BASES = {"BaseModel", "TypedDict", "dataclass"}


def _run(cmd: list[str], cwd: Path, timeout: int = 60) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout, check=False)
        return r.returncode, (r.stdout + r.stderr)
    except Exception as exc:
        return 127, str(exc)


def _check_uv_lock_drift(repo: Path) -> list[dict[str, Any]]:
    if not (repo / "uv.lock").exists() or not (repo / "pyproject.toml").exists():
        return []
    if not shutil.which("uv"):
        return []
    rc, out = _run(["uv", "lock", "--check"], repo)
    if rc == 0:
        return []
    return [finding(
        GATE_ID, GATE_NAME, "uv-lock-drift", "lockfile-manifest-drift",
        SEVERITY_MEDIUM, CONF_HIGH, AUTH_BLOCKER,
        {"detail": out[:300]},
        "uv.lock is out of sync with pyproject.toml",
        remediation("downstream-agent", ["run `uv lock` to regenerate the lockfile"], ["uv lock"], "uv_lock"),
        autofix_plan={"action": "uv_lock", "command": "uv lock",
                      "description": "regenerate uv.lock from pyproject.toml",
                      "reversible": True, "gate": GATE_ID},
    )]


def _check_npm_lock_drift(repo: Path) -> list[dict[str, Any]]:
    if not (repo / "package-lock.json").exists() or not (repo / "package.json").exists():
        return []
    if not shutil.which("npm"):
        return []
    rc, out = _run(["npm", "ci", "--dry-run"], repo, timeout=120)
    if rc == 0:
        return []
    return [finding(
        GATE_ID, GATE_NAME, "npm-lock-drift", "lockfile-manifest-drift",
        SEVERITY_MEDIUM, CONF_HIGH, AUTH_BLOCKER,
        {"detail": out[:300]},
        "package-lock.json is out of sync with package.json",
        remediation("downstream-agent", ["run `npm ci`"], ["npm ci"], "npm_ci"),
        autofix_plan={"action": "npm_ci", "command": "npm ci",
                      "description": "sync node_modules to package-lock.json",
                      "reversible": True, "gate": GATE_ID},
    )]


def _check_pip_conflicts(repo: Path) -> list[dict[str, Any]]:
    pip = shutil.which("pip")
    if not pip:
        return []
    rc, out = _run([pip, "check"], repo)
    if rc == 0:
        return []
    return [finding(
        GATE_ID, GATE_NAME, "pip-dependency-conflict", "version-conflict",
        SEVERITY_HIGH, CONF_HIGH, AUTH_BLOCKER,
        {"pip_check_output": out[:500]},
        "pip check reports broken dependency tree — cannot safely auto-resolve version conflicts",
        remediation("human", ["resolve the version conflict in pyproject.toml / requirements files"],
                    ["pip check"]),
    )]


def _check_shared_type_divergence(repo: Path) -> list[dict[str, Any]]:
    model_defs: dict[str, list[str]] = {}
    for p in sorted(repo.rglob("*.py")):
        if any(s in _SKIP for s in p.relative_to(repo).parts):
            continue
        rel = str(p.relative_to(repo))
        try:
            tree = ast.parse(p.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                bases = {b.id if isinstance(b, ast.Name) else
                         b.attr if isinstance(b, ast.Attribute) else ""
                         for b in node.bases}
                if bases & _BASES:
                    model_defs.setdefault(node.name, []).append(rel)
    dupes = {name: files for name, files in model_defs.items() if len(files) > 1}
    if not dupes:
        return []
    return [finding(
        GATE_ID, GATE_NAME, "shared-type-divergence", "duplicate-model-definition",
        SEVERITY_LOW, CONF_LOW, AUTH_TECH_DEBT,
        {"duplicates": {k: v for k, v in list(dupes.items())[:10]}},
        None,
        remediation("human",
                    ["consolidate duplicate model definitions into a shared types module"]),
    )]


def evaluate(evidence: dict[str, Any], ctx: dict[str, Any]) -> list[dict[str, Any]]:
    repo = ctx.get("repo")
    if repo is None:
        return []
    if not isinstance(repo, Path):
        repo = Path(repo)
    findings: list[dict[str, Any]] = []
    for check_fn in (_check_uv_lock_drift, _check_npm_lock_drift,
                     _check_pip_conflicts, _check_shared_type_divergence):
        try:
            findings.extend(check_fn(repo))
        except Exception as exc:
            findings.append(finding(
                GATE_ID, GATE_NAME, f"gate12-{check_fn.__name__}-error", "internal",
                SEVERITY_LOW, CONF_LOW, None, {"error": str(exc)[:300]},
                None, remediation("human", [f"gate12 {check_fn.__name__} crashed"]),
            ))
    return findings
