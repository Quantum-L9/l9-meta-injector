"""GitHub issue sync for unresolved blockers — idempotent, sanitized.

For every unresolved blocker: derive a stable dedupe key, search open+closed
issues, update an equivalent open issue, reopen an equivalent closed one when the
blocker is still unresolved, or create a new issue. Never includes secret values —
the body is built only from already-redacted blocker fields.
"""

from __future__ import annotations

import hashlib
from typing import Any

from .github import GitHubAdapter
from .redaction import redact

LABELS = ["preflight", "blocker"]


def dedupe_key(repo_slug: str, blocker: dict[str, Any]) -> str:
    """repository + blocker_type + affected_artifact + normalized_failure -> stable key."""
    artifact = blocker.get("gate_name") or blocker.get("evidence", {}).get("action") or ""
    failure = redact(blocker.get("class", "") + "|" + str(blocker.get("why_not_autofixable", "")))
    raw = f"{repo_slug}|{blocker.get('class', '')}|{artifact}|{failure}"
    return "preflight-" + hashlib.sha256(raw.encode()).hexdigest()[:16]


def _marker(key: str) -> str:
    return f"<!-- preflight-dedupe: {key} -->"


def issue_title(blocker: dict[str, Any]) -> str:
    return f"[preflight] {blocker.get('class', 'blocker')}: {blocker.get('id', '')}"


def issue_body(blocker: dict[str, Any], key: str) -> str:
    """All fields are redacted; no secret value can appear."""
    ev = blocker.get("evidence", {})
    rem = blocker.get("remediation", {})
    lines = [
        _marker(key),
        "",
        f"- **blocker_id:** {blocker.get('id')}",
        f"- **affected_gate:** {blocker.get('gate')} ({blocker.get('gate_name')})",
        f"- **failed_action:** {ev.get('action', 'n/a')}",
        f"- **sanitized_command:** `{redact(str(ev.get('command', 'n/a')))}`",
        f"- **sanitized_error:** {redact(str(ev.get('error', 'n/a')))}",
        f"- **evidence_paths:** {', '.join(ev.get('evidence_paths', [])) or 'docs/preflight/'}",
        f"- **required_human_action:** {'; '.join(rem.get('steps', [])) or 'resolve manually'}",
        "",
        "### Reproduction steps",
        "1. run the preflight remediation loop on this repository",
        f"2. observe the `{blocker.get('class')}` blocker on gate {blocker.get('gate')}",
        "",
        "### Acceptance criteria",
        "- the blocker no longer appears in `docs/preflight/blockers.yaml`",
        "- preflight `overall_status` is not `blocked` for this cause",
    ]
    return "\n".join(lines)


def _equivalent(issues: list[dict[str, Any]], key: str) -> dict[str, Any] | None:
    for i in issues:
        if i.get("dedupe_key") == key or _marker(key) in str(i.get("body", "")):
            return i
    return None


def sync_issue(adapter: GitHubAdapter, repo_slug: str, blocker: dict[str, Any]) -> dict[str, Any]:
    key = dedupe_key(repo_slug, blocker)
    body = issue_body(blocker, key)
    found = _equivalent(adapter.search_issues(repo_slug, key), key)
    if found is None:
        rec = adapter.create_issue(repo_slug, issue_title(blocker), body, LABELS)
        return {**rec, "dedupe_key": key, "action": "created"}
    number = found.get("number")
    state = str(found.get("state", "open")).lower()
    reopen = state in ("closed", "closed_completed")  # still unresolved -> reopen
    rec = adapter.update_issue(repo_slug, number, body, reopen)
    return {**rec, "dedupe_key": key, "action": "reopened" if reopen else "updated"}


def sync_all(
    adapter: GitHubAdapter, repo_slug: str, blockers: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Dedupe within the run, then sync each unique blocker exactly once."""
    seen, receipts = set(), []
    for b in blockers:
        key = dedupe_key(repo_slug, b)
        if key in seen:
            continue
        seen.add(key)
        adapter.ensure_labels(repo_slug, LABELS)
        receipts.append(sync_issue(adapter, repo_slug, b))
    return receipts
