"""Gate 10 — Dormant / Unreachable Capability Detection (fail-open)."""
from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any

from ._common import (
    AUTH_BLOCKER, AUTH_TECH_DEBT,
    CONF_HIGH, CONF_LOW, CONF_MEDIUM,
    SEVERITY_HIGH, SEVERITY_LOW,
    finding, remediation,
)
from .extractors.extract_flag_refs import extract_flag_definitions, extract_flag_references

GATE_ID = 10
GATE_NAME = "dormant-capability"

_INTENTIONAL = re.compile(r'#\s*(?:noqa:\s*dead|dead.?code:\s*intentional|pgla:skip)', re.IGNORECASE)
_SKIP = {".git", "node_modules", ".venv", "__pycache__", ".preflight", "dist", "build"}
_MIN_LINES = 3


def _collect_py_defs_and_refs(repo: Path) -> tuple[list[dict], set[str]]:
    defs: list[dict] = []
    all_refs: set[str] = set()
    for p in sorted(repo.rglob("*.py")):
        if any(s in _SKIP for s in p.relative_to(repo).parts):
            continue
        rel = str(p.relative_to(repo))
        try:
            src = p.read_text(encoding="utf-8", errors="ignore")
            tree = ast.parse(src, filename=rel)
        except Exception:
            continue
        lines = src.splitlines()
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                all_refs.add(node.id)
            elif isinstance(node, ast.Attribute):
                all_refs.add(node.attr)
        for node in ast.iter_child_nodes(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                lineno = node.lineno
                line_text = lines[lineno - 1] if lineno <= len(lines) else ""
                if _INTENTIONAL.search(line_text):
                    continue
                name = node.name
                if name.startswith("__") and name.endswith("__"):
                    continue
                end = getattr(node, "end_lineno", lineno)
                if (end - lineno) < _MIN_LINES:
                    continue
                defs.append({"name": name, "file": rel, "line": lineno, "type": type(node).__name__})
    return defs, all_refs


def _check_dead_python(repo: Path) -> list[dict[str, Any]]:
    try:
        defs, all_refs = _collect_py_defs_and_refs(repo)
    except Exception as exc:
        return [finding(GATE_ID, GATE_NAME, "gate10-py-probe-error", "internal",
                        SEVERITY_LOW, CONF_LOW, None, {"error": str(exc)[:300]},
                        None, remediation("human", ["gate10 py probe failed"]))]
    dead = [d for d in defs if d["name"] not in all_refs]
    if not dead:
        return []
    return [finding(
        GATE_ID, GATE_NAME, "dead-python-symbol", "unreferenced-definition",
        SEVERITY_LOW, CONF_MEDIUM, AUTH_TECH_DEBT,
        {"dead_symbols": dead[:15], "count": len(dead)},
        None,
        remediation("human",
                    ["review dead symbols; if confirmed dead, remove in a follow-up PR",
                     "add # noqa: dead if intentionally dormant"]),
    )]


def _check_feature_flags(repo: Path) -> list[dict[str, Any]]:
    try:
        defined = extract_flag_definitions(repo)
        referenced = extract_flag_references(repo)
    except Exception as exc:
        return [finding(GATE_ID, GATE_NAME, "gate10-flag-probe-error", "internal",
                        SEVERITY_LOW, CONF_LOW, None, {"error": str(exc)[:300]},
                        None, remediation("human", ["gate10 flag probe failed"]))]
    results: list[dict[str, Any]] = []
    orphan_defs = sorted(defined - referenced)
    if orphan_defs:
        results.append(finding(
            GATE_ID, GATE_NAME, "stale-flag-definition", "defined-not-referenced",
            SEVERITY_LOW, CONF_MEDIUM, AUTH_TECH_DEBT,
            {"flags": orphan_defs},
            None,
            remediation("human", ["remove stale flag definitions from the flag manifest"]),
        ))
    undefined_refs = sorted(referenced - defined) if defined else []
    if undefined_refs and defined:
        results.append(finding(
            GATE_ID, GATE_NAME, "undefined-flag-reference", "referenced-not-defined",
            SEVERITY_HIGH, CONF_HIGH, AUTH_BLOCKER,
            {"flags": undefined_refs},
            "referencing an undefined feature flag will raise KeyError / return None at runtime",
            remediation("human",
                        ["add missing flag definitions to the flag manifest",
                         "or update code to use the correct flag name"]),
        ))
    return results


def evaluate(evidence: dict[str, Any], ctx: dict[str, Any]) -> list[dict[str, Any]]:
    repo = ctx.get("repo")
    if repo is None:
        return []
    if not isinstance(repo, Path):
        repo = Path(repo)
    findings: list[dict[str, Any]] = []
    for check_fn in (_check_dead_python, _check_feature_flags):
        try:
            findings.extend(check_fn(repo))
        except Exception as exc:
            findings.append(finding(
                GATE_ID, GATE_NAME, f"gate10-{check_fn.__name__}-error", "internal",
                SEVERITY_LOW, CONF_LOW, None, {"error": str(exc)[:300]},
                None, remediation("human", [f"gate10 {check_fn.__name__} crashed"]),
            ))
    return findings
