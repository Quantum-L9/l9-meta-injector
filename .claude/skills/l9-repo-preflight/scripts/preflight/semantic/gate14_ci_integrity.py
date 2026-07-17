"""Gate 14 — CI Integrity & Green-Truth Verification (fail-open)."""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from ._common import (
    AUTH_BLOCKER, AUTH_TECH_DEBT,
    CONF_HIGH, CONF_LOW, CONF_MEDIUM,
    SEVERITY_CRITICAL, SEVERITY_HIGH, SEVERITY_MEDIUM, SEVERITY_LOW,
    finding, remediation,
)
from .extractors.scan_fake_green import scan_workflows
from .extractors.scan_workflow_pins import scan_unpinned

GATE_ID = 14
GATE_NAME = "ci-integrity"


def _check_workflow_presence(repo: Path) -> list[dict[str, Any]]:
    wf_dir = repo / ".github" / "workflows"
    if wf_dir.is_dir() and list(wf_dir.glob("*.y*ml")):
        return []
    return [finding(
        GATE_ID, GATE_NAME, "no-ci-workflows", "missing-ci",
        SEVERITY_CRITICAL, CONF_HIGH, AUTH_BLOCKER,
        {"workflows_dir": str(wf_dir.relative_to(repo)) if repo.exists() else ".github/workflows",
         "exists": wf_dir.is_dir()},
        "no GitHub Actions workflow files found — CI cannot run",
        remediation("human",
                    ["add at least one workflow file under .github/workflows/",
                     "see references/ci-core-usage.md for l9-ci-core reusable templates"]),
    )]


def _check_actionlint(repo: Path) -> list[dict[str, Any]]:
    if not shutil.which("actionlint"):
        return []
    try:
        r = subprocess.run(["actionlint", "-color=false"],
                           cwd=str(repo), capture_output=True, text=True, timeout=60, check=False)
        out = (r.stdout + r.stderr).strip()
        if not out or r.returncode == 0:
            return []
        errors = [l for l in out.splitlines() if l.strip() and "error:" in l.lower()]
        return [finding(
            GATE_ID, GATE_NAME, "actionlint-error", "workflow-syntax-error",
            SEVERITY_HIGH, CONF_HIGH, AUTH_BLOCKER,
            {"errors": errors[:20], "count": len(errors)},
            "workflow syntax errors block CI from running — must be fixed manually",
            remediation("human", ["fix the reported actionlint errors"], ["actionlint -color=false"]),
        )]
    except Exception as exc:
        return [finding(GATE_ID, GATE_NAME, "gate14-actionlint-error", "internal",
                        SEVERITY_LOW, CONF_LOW, None, {"error": str(exc)[:300]},
                        None, remediation("human", ["actionlint probe failed"]))]


def _check_fake_green(repo: Path) -> list[dict[str, Any]]:
    try:
        hits = scan_workflows(repo)
    except Exception as exc:
        return [finding(GATE_ID, GATE_NAME, "gate14-fake-green-probe-error", "internal",
                        SEVERITY_LOW, CONF_LOW, None, {"error": str(exc)[:300]},
                        None, remediation("human", ["fake-green scan failed"]))]
    if not hits:
        return []
    critical_patterns = {"if-false-skip", "coverage-gate-disabled", "empty-matrix"}
    has_critical = any(h["pattern"] in critical_patterns for h in hits)
    return [finding(
        GATE_ID, GATE_NAME, "fake-green-ci", "ci-green-not-trustworthy",
        SEVERITY_HIGH if has_critical else SEVERITY_MEDIUM,
        CONF_HIGH, AUTH_BLOCKER,
        {"patterns": hits[:20], "count": len(hits), "critical_patterns": has_critical},
        "CI passes without genuinely verifying code — green is meaningless for these jobs",
        remediation("human",
                    ["remove `continue-on-error: true` from test/lint jobs",
                     "remove `|| true` from test commands",
                     "set coverage thresholds > 0"]),
    )]


def _check_unpinned_actions(repo: Path) -> list[dict[str, Any]]:
    try:
        hits = scan_unpinned(repo)
    except Exception as exc:
        return [finding(GATE_ID, GATE_NAME, "gate14-pin-probe-error", "internal",
                        SEVERITY_LOW, CONF_LOW, None, {"error": str(exc)[:300]},
                        None, remediation("human", ["pin scan failed"]))]
    if not hits:
        return []
    return [finding(
        GATE_ID, GATE_NAME, "unpinned-action-ref", "mutable-action-ref",
        SEVERITY_MEDIUM, CONF_HIGH, AUTH_TECH_DEBT,
        {"unpinned": hits[:20], "count": len(hits)},
        None,
        remediation("downstream-agent",
                    ["pin all action refs to exact SHAs via l9-ci-core ci-migration path"],
                    [], "pin_action_sha"),
        autofix_plan={"action": "pin_action_sha", "command": "ci-migration --pin-actions",
                      "description": "pin all action refs to exact SHAs",
                      "reversible": True, "gate": GATE_ID},
    )]


def evaluate(evidence: dict[str, Any], ctx: dict[str, Any]) -> list[dict[str, Any]]:
    repo = ctx.get("repo")
    if repo is None:
        return []
    if not isinstance(repo, Path):
        repo = Path(repo)
    findings: list[dict[str, Any]] = []
    for check_fn in (_check_workflow_presence, _check_actionlint,
                     _check_fake_green, _check_unpinned_actions):
        try:
            findings.extend(check_fn(repo))
        except Exception as exc:
            findings.append(finding(
                GATE_ID, GATE_NAME, f"gate14-{check_fn.__name__}-error", "internal",
                SEVERITY_LOW, CONF_LOW, None, {"error": str(exc)[:300]},
                None, remediation("human", [f"gate14 {check_fn.__name__} crashed"]),
            ))
    return findings
