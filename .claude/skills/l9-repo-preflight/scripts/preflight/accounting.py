"""Blocker accounting — a failed applicable autofix is an UNRESOLVED blocker.

The contract's rule: a report must never claim zero blockers when an attempted
repair failed. This module reconciles the evaluate report's genuine blockers with
the outcomes of every attempted autofix action and produces the final accounting.

Classification (from the action outcome):
  successful_autofix              -> resolved
  failed_autofix                  -> unresolved_blocker
  missing_token                   -> unresolved_blocker
  missing_permission              -> unresolved_blocker
  inaccessible_private_dependency -> unresolved_blocker
  no_applicable_action            -> not_applicable

blocker_count == every unresolved blocking finding remaining after permitted
autofixes complete (evaluate's genuine blockers + failed-autofix blockers).
"""

from __future__ import annotations

from typing import Any

from .redaction import redact

RESOLVED = "resolved"
UNRESOLVED = "unresolved_blocker"
NOT_APPLICABLE = "not_applicable"

_SEVERITY = {
    "missing_token": "high",
    "missing_permission": "high",
    "inaccessible_private_dependency": "high",
    "failed_autofix": "high",
}


def classify_action(action: dict[str, Any]) -> str:
    """Map one autofix action record to a classification."""
    result = str(action.get("result", ""))
    command = str(action.get("command", ""))
    err = redact(str(action.get("error", ""))).lower()
    if command.startswith("skip"):
        # a skip because the fix does not apply here is not a blocker;
        # a skip because a precondition is unmet leaves the underlying gate blocker.
        return NOT_APPLICABLE
    if result == "ok":
        return RESOLVED
    # failed: classify by the sanitized error text
    if any(k in err for k in ("401", "unauthorized", "e401", "authentication failed")):
        if any(k in (command + err) for k in ("npm", "registry", "package", "pip")):
            return "inaccessible_private_dependency"
        return "missing_token"
    if any(
        k in err
        for k in (
            "403",
            "forbidden",
            "permission",
            "protected branch",
            "not allowed",
            "denied",
            "authorization failed",
            "authorization",
        )
    ):
        return "missing_permission"
    if any(
        k in err
        for k in (
            "could not read username",
            "no credentials",
            "authentication required",
            "gh_token",
            "no such remote",
            "authentication",
        )
    ):
        return "missing_token"
    return "failed_autofix"


def _blocker_from_failed(action: dict[str, Any], classification: str) -> dict[str, Any]:
    gate = action.get("gate", 0)
    act = action.get("action", "unknown")
    human = {
        "missing_token": "provide the required token (e.g. GH_TOKEN / NPM_TOKEN) with correct scope",
        "missing_permission": "grant the required repository permission / lift branch protection",
        "inaccessible_private_dependency": "grant access to the private dependency / registry",
        "failed_autofix": "resolve the underlying error, then re-run preflight",
    }[classification]
    return {
        "id": f"BLK-{gate}-{classification}-{act}",
        "gate": gate,
        "gate_name": act,
        "class": classification,
        "severity": _SEVERITY.get(classification, "high"),
        "why_not_autofixable": f"autofix '{act}' was applicable but failed: {classification}",
        "evidence": {
            "action": act,
            "command": redact(str(action.get("command", ""))),
            "error": redact(str(action.get("error", ""))),
        },
        "remediation": {
            "owner": "human",
            "steps": [human, "re-run preflight after resolving"],
            "commands": [],
            "auto_option": None,
        },
    }


def reconcile(evaluate_report: dict[str, Any], actions: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge evaluate's genuine blockers with failed-autofix blockers.

    Returns {unresolved_blockers, resolved, not_applicable, blocker_count,
    overall_status}. overall_status is 'blocked' when any unresolved blocker
    remains, else 'ready'.
    """
    resolved, not_applicable, failed = [], [], []
    for a in actions:
        cls = classify_action(a)
        if cls == RESOLVED:
            resolved.append(a)
        elif cls == NOT_APPLICABLE:
            not_applicable.append(a)
        else:
            failed.append(_blocker_from_failed(a, cls))

    unresolved = list(evaluate_report.get("genuine_blockers", []))
    # de-dup failed-autofix blockers by id against evaluate blockers
    seen = {b.get("id") for b in unresolved}
    for b in failed:
        if b["id"] not in seen:
            unresolved.append(b)
            seen.add(b["id"])

    return {
        "unresolved_blockers": unresolved,
        "resolved": resolved,
        "not_applicable": not_applicable,
        "blocker_count": len(unresolved),
        "overall_status": "blocked" if unresolved else "ready",
    }
