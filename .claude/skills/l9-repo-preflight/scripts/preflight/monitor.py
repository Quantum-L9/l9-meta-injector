"""Bounded pull-request monitoring with terminal states.

After an autofix PR is opened, watch its required checks / CI / reviews and apply
bounded, deterministic corrections to the same branch. Escalate (never guess) on
credentials, permissions, private dependencies, ambiguous architecture, security
policy, or destructive/protected actions. Stops at a terminal state or the repair
cycle limit (default 5).
"""

from __future__ import annotations

from typing import Any, Callable

from .github import GitHubAdapter

AUTO_FIXABLE = {
    "formatting",
    "lint",
    "type_errors",
    "deterministic_test_failures",
    "broken_paths",
    "schema_validation_failures",
    "report_generation_failures",
    "actionable_review_feedback_with_clear_acceptance_criteria",
}
ESCALATE = {
    "missing_credentials",
    "missing_permissions",
    "unavailable_private_dependencies",
    "ambiguous_architecture_requests",
    "security_policy_conflicts",
    "destructive_or_protected_actions",
}

READY = "ready_for_human_merge"
BLOCKED_EXTERNAL = "blocked_by_external_dependency"
PROTECTED = "protected_action_requires_approval"
CYCLE_LIMIT = "repair_cycle_limit_reached"


def _classify(status: dict[str, Any]) -> tuple[str, list[str]]:
    """Return (disposition, categories). disposition in {green, auto, escalate}."""
    if status.get("status") in ("green", "success", "passing") and not status.get("failures"):
        return "green", []
    cats = [f.get("category", "") for f in status.get("failures", [])]
    cats += [
        t.get("category", "") for t in status.get("review_threads", []) if not t.get("resolved")
    ]
    if any(c in ESCALATE for c in cats):
        return "escalate", [c for c in cats if c in ESCALATE]
    if cats and all(c in AUTO_FIXABLE for c in cats):
        return "auto", cats
    if cats:  # unknown category -> escalate rather than guess
        return "escalate", [c for c in cats if c not in AUTO_FIXABLE]
    return "green", []


def monitor(
    adapter: GitHubAdapter,
    repo_slug: str,
    pr_number: int,
    repair: Callable[[list[str]], bool],
    *,
    max_cycles: int = 5,
) -> dict[str, Any]:
    """Loop until a terminal state or the cycle cap. `repair(categories)` applies a
    bounded correction to the PR branch and returns True if it changed anything."""
    receipts: list[dict[str, Any]] = []
    for cycle in range(1, max_cycles + 1):
        status = adapter.pr_status(repo_slug, pr_number)
        disposition, cats = _classify(status)
        receipts.append(
            {
                "effect": "monitoring_cycle_completed",
                "cycle": cycle,
                "disposition": disposition,
                "categories": cats,
            }
        )
        if disposition == "green":
            return {"terminal_state": READY, "cycles": cycle, "receipts": receipts}
        if disposition == "escalate":
            protected = any(
                c in ("destructive_or_protected_actions", "security_policy_conflicts") for c in cats
            )
            state = PROTECTED if protected else BLOCKED_EXTERNAL
            return {
                "terminal_state": state,
                "cycles": cycle,
                "escalated": cats,
                "receipts": receipts,
            }
        # auto-fixable: apply a bounded repair to the same branch
        changed = repair(cats)
        receipts.append(
            {
                "effect": "bounded_repair_applied",
                "cycle": cycle,
                "categories": cats,
                "changed": changed,
            }
        )
        if not changed:  # nothing we could safely do -> escalate rather than spin
            return {"terminal_state": BLOCKED_EXTERNAL, "cycles": cycle, "receipts": receipts}
    return {"terminal_state": CYCLE_LIMIT, "cycles": max_cycles, "receipts": receipts}
