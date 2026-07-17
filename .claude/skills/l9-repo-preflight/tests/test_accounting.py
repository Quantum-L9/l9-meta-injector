"""Unit: blocker accounting — failed autofix => unresolved blocker; redaction."""

from __future__ import annotations

from preflight import accounting


def _report(blockers=None):
    return {"genuine_blockers": blockers or []}


def test_failed_autofix_increments_blocker_count():
    actions = [
        {
            "gate": 6,
            "action": "npm_install",
            "command": "npm ci",
            "result": "rc=1",
            "error": "npm error code E401",
        }
    ]
    acct = accounting.reconcile(_report(), actions)
    assert acct["blocker_count"] == 1
    assert acct["overall_status"] == "blocked"


def test_successful_autofix_resolves_blocker():
    actions = [{"gate": 3, "action": "clean_generated", "command": "rm -rf x", "result": "ok"}]
    acct = accounting.reconcile(_report(), actions)
    assert acct["blocker_count"] == 0
    assert len(acct["resolved"]) == 1
    assert acct["overall_status"] == "ready"


def test_no_applicable_action_is_not_a_blocker():
    actions = [
        {"gate": 7, "action": "ruff_fix", "command": "skip (--no-fix-code)", "result": "rc=1"}
    ]
    acct = accounting.reconcile(_report(), actions)
    assert acct["blocker_count"] == 0
    assert len(acct["not_applicable"]) == 1


def test_missing_token_generates_sanitized_blocker():
    actions = [
        {
            "gate": 2,
            "action": "git_switch_branch",
            "command": "git push",
            "result": "rc=1",
            "error": "remote: Authorization failed. token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
        }
    ]
    acct = accounting.reconcile(_report(), actions)
    assert acct["blocker_count"] == 1
    blk = acct["unresolved_blockers"][0]
    assert blk["class"] in (
        "missing_token",
        "missing_permission",
        "inaccessible_private_dependency",
    )
    # secret value must not appear anywhere in the blocker
    assert "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" not in str(blk)


def test_npm_401_classified_as_private_dependency():
    actions = [
        {
            "gate": 6,
            "action": "npm_install",
            "command": "npm ci",
            "result": "rc=1",
            "error": "npm ERR! 401 Unauthorized - GET https://npm.pkg.github.com/@scope%2fpkg",
        }
    ]
    assert accounting.classify_action(actions[0]) == "inaccessible_private_dependency"
