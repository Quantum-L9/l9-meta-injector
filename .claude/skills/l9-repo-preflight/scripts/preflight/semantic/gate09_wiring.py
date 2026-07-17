"""Gate 9 — Wiring Integrity (fail-open)."""
from __future__ import annotations

import ast
import importlib.util
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from ._common import (
    AUTH_BLOCKER, AUTH_TECH_DEBT,
    CONF_HIGH, CONF_LOW, CONF_MEDIUM,
    SEVERITY_HIGH, SEVERITY_MEDIUM, SEVERITY_LOW,
    finding, remediation,
)
from .extractors.extract_key_refs import extract_provided, extract_referenced

GATE_ID = 9
GATE_NAME = "wiring-integrity"

_CRITICAL_KEY_PATTERNS = re.compile(
    r"(SECRET|TOKEN|KEY|PASSWORD|PASS|CREDENTIAL|DSN|DATABASE_URL|API_KEY|PRIVATE)",
    re.IGNORECASE,
)
_SKIP = {".git", "node_modules", ".venv", "__pycache__", ".preflight"}


def _check_env_wiring(repo: Path) -> list[dict[str, Any]]:
    try:
        referenced = extract_referenced(repo)
        provided = extract_provided(repo)
    except Exception as exc:
        return [finding(GATE_ID, GATE_NAME, "env-wiring-probe-failure", "probe",
                        SEVERITY_LOW, CONF_LOW, None, {"error": str(exc)[:300]},
                        None, remediation("human", ["env wiring probe failed"]))]
    missing = sorted(referenced - provided)
    if not missing:
        return []
    results = []
    for key in missing:
        is_critical = bool(_CRITICAL_KEY_PATTERNS.search(key))
        sev = SEVERITY_HIGH if is_critical else SEVERITY_MEDIUM
        autofix = None if is_critical else {
            "action": "append_env_example",
            "command": f"append {key}= to .env.example",
            "description": f"declare non-secret configuration key {key} in .env.example",
            "reversible": True, "gate": GATE_ID, "key": key, "default": "",
        }
        results.append(finding(
            GATE_ID, GATE_NAME,
            "missing-env-binding",
            "critical-env" if is_critical else "non-critical-env",
            sev, CONF_MEDIUM,
            AUTH_BLOCKER if is_critical else AUTH_TECH_DEBT,
            {"key": key, "referenced_in_code": True, "provided": False},
            "critical secret key has no definition in .env*, config, or secrets manifest" if is_critical else None,
            remediation("human",
                        [f"add {key} to .env.example or inject via CI secrets"],
                        [f"grep -r '{key}' . --include='*.py' --include='*.ts'"]) if is_critical
            else remediation("downstream-agent", [f"append {key}= to .env.example"], [],
                             f"append_env_example:{key}"),
            autofix_plan=autofix,
        ))
    return results


def _check_python_imports(repo: Path) -> list[dict[str, Any]]:
    broken: list[dict[str, Any]] = []
    for p in sorted(repo.rglob("*.py")):
        if any(s in _SKIP for s in p.relative_to(repo).parts):
            continue
        try:
            lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            continue
        rel = str(p.relative_to(repo))
        for i, line in enumerate(lines, 1):
            stripped = line.strip()
            if not (stripped.startswith("import ") or stripped.startswith("from ")):
                continue
            m = re.match(r'^(?:import|from)\s+([A-Za-z_][A-Za-z0-9_]*)', stripped)
            if not m:
                continue
            pkg = m.group(1)
            if pkg in {"__future__", ""} or stripped.startswith("from ."):
                continue
            try:
                spec = importlib.util.find_spec(pkg)
            except (ModuleNotFoundError, ValueError):
                spec = None
            if spec is None:
                broken.append({"file": rel, "line": i, "package": pkg})
    if not broken:
        return []
    return [finding(
        GATE_ID, GATE_NAME, "unresolved-python-import", "import-missing",
        SEVERITY_HIGH, CONF_HIGH, AUTH_BLOCKER,
        {"broken_imports": broken[:20], "count": len(broken)},
        "unresolved imports block execution; cannot safely install unknown packages automatically",
        remediation("human", ["run `pip install -e .` or install missing packages",
                               "verify pyproject.toml / requirements files"],
                    ["pip install -e .", "pip check"]),
    )]


def _check_node_deps(repo: Path) -> list[dict[str, Any]]:
    pkg_json = repo / "package.json"
    if not pkg_json.exists():
        return []
    try:
        manifest = json.loads(pkg_json.read_text(encoding="utf-8"))
    except Exception:
        return []
    all_deps = (set(manifest.get("dependencies", {}).keys()) |
                set(manifest.get("devDependencies", {}).keys()))
    node_modules = repo / "node_modules"
    if not node_modules.is_dir():
        return []

    def _dep_missing(d: str) -> bool:
        if "/" in d:
            return not (node_modules / d).is_dir()
        return not (node_modules / d).is_dir() and not (node_modules / ("@" + d.split("/")[0])).is_dir()

    missing = sorted(d for d in all_deps if _dep_missing(d))
    if not missing:
        return []
    return [finding(
        GATE_ID, GATE_NAME, "node-dep-not-installed", "missing-node-module",
        SEVERITY_MEDIUM, CONF_HIGH, AUTH_BLOCKER,
        {"missing_packages": missing[:20], "count": len(missing)},
        "declared npm deps absent from node_modules; npm ci can fix but was not run yet",
        remediation("downstream-agent", ["run npm ci"], ["npm ci"]),
        autofix_plan={"action": "npm_ci", "command": "npm ci",
                      "description": "install declared node deps from lockfile",
                      "reversible": True, "gate": GATE_ID},
    )]


def evaluate(evidence: dict[str, Any], ctx: dict[str, Any]) -> list[dict[str, Any]]:
    repo = ctx.get("repo")
    if repo is None:
        return []
    if not isinstance(repo, Path):
        repo = Path(repo)
    findings: list[dict[str, Any]] = []
    for check_fn in (_check_env_wiring, _check_python_imports, _check_node_deps):
        try:
            findings.extend(check_fn(repo))
        except Exception as exc:
            findings.append(finding(
                GATE_ID, GATE_NAME, f"gate9-{check_fn.__name__}-error", "internal",
                SEVERITY_LOW, CONF_LOW, None, {"error": str(exc)[:300]},
                None, remediation("human", [f"gate9 {check_fn.__name__} crashed; non-fatal"]),
            ))
    return findings
