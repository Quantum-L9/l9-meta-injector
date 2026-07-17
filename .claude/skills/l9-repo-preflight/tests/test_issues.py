"""Unit: issue sync — create/update/dedupe, secret redaction."""

from __future__ import annotations

from preflight import issues
from preflight.github import DryRunAdapter


def _blocker(cls="missing_token"):
    return {
        "id": f"BLK-6-{cls}-npm_install",
        "gate": 6,
        "gate_name": "npm_install",
        "class": cls,
        "severity": "high",
        "why_not_autofixable": "npm ci failed",
        "evidence": {
            "action": "npm_install",
            "command": "npm ci",
            "error": "401 token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
        },
        "remediation": {"owner": "human", "steps": ["provide NPM_TOKEN"], "commands": []},
    }


def test_missing_token_creates_issue():
    ad = DryRunAdapter()
    receipts = issues.sync_all(ad, "owner/repo", [_blocker()])
    assert len(receipts) == 1
    assert receipts[0]["action"] == "created"


def test_duplicate_issue_is_not_created():
    b = _blocker()
    key = issues.dedupe_key("owner/repo", b)
    ad = DryRunAdapter(state={"issues": [{"number": 7, "state": "open", "dedupe_key": key}]})
    receipts = issues.sync_all(ad, "owner/repo", [b])
    assert receipts[0]["action"] == "updated"  # updated existing, not created
    assert not any(i["effect"] == "create_issue" for i in ad.intents)


def test_closed_equivalent_is_reopened_when_unresolved():
    b = _blocker()
    key = issues.dedupe_key("owner/repo", b)
    ad = DryRunAdapter(state={"issues": [{"number": 9, "state": "closed", "dedupe_key": key}]})
    receipts = issues.sync_all(ad, "owner/repo", [b])
    assert receipts[0]["action"] == "reopened"


def test_same_blocker_twice_dedupes_within_run():
    ad = DryRunAdapter()
    receipts = issues.sync_all(ad, "owner/repo", [_blocker(), _blocker()])
    assert len(receipts) == 1


def test_secrets_are_redacted_in_issue_body():
    key = issues.dedupe_key("owner/repo", _blocker())
    body = issues.issue_body(_blocker(), key)
    assert "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" not in body
    assert "REDACTED" in body
