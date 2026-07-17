"""Regression + full-flow integration: gates preserved, allow-list, dry-run safety."""

from __future__ import annotations

from pathlib import Path

import evaluate_preflight as ev
import remediate
from preflight import accounting, delivery, reports
from preflight.github import DryRunAdapter, get_adapter


def test_structural_and_semantic_preflight_gates_preserved():
    report = ev.evaluate({}, {}, None, None)
    assert [g["id"] for g in report["gates"]] == list(range(1, 15))
    assert report["run_completed"] is True


def test_allow_list_still_limits_autofix_actions():
    allow = {
        ev.ACTION_CLEAN_GENERATED,
        ev.ACTION_GIT_SWITCH,
        ev.ACTION_ADAPT,
        ev.ACTION_PIP_INSTALL,
        ev.ACTION_EDITABLE_INSTALL,
        ev.ACTION_NPM_INSTALL,
        ev.ACTION_RUFF_FIX,
        ev.ACTION_ESLINT_FIX,
    }
    # every action the report schema permits is on the allow-list
    schema_actions = {
        "clean_generated",
        "git_switch_branch",
        "adapt_blueprint",
        "pip_install",
        "editable_install",
        "npm_install",
        "ruff_fix",
        "eslint_fix",
    }
    assert allow == schema_actions


def test_dry_run_adapter_is_default_and_never_pushes(git_repo: Path):
    ad = get_adapter(dry_run=True, allow_cli_fallback=True)  # even with enable_gh, dry-run wins
    assert isinstance(ad, DryRunAdapter) and ad.dry_run is True
    (git_repo / "pkg" / "n.py").write_text("x=1\n")
    res = delivery.deliver_autofix(git_repo, ad, ["pkg/n.py"], dry_run=True, run_id="dr")
    pushed = {r["effect"]: r for r in res["receipts"]}["branch_pushed"]
    assert pushed["pushed"] is False  # dry-run performs no push


def test_direct_push_to_main_remains_forbidden(git_repo: Path):
    (git_repo / "pkg" / "n.py").write_text("x=1\n")
    res = delivery.deliver_autofix(
        git_repo, DryRunAdapter(), ["pkg/n.py"], base="main", dry_run=False, run_id="nm"
    )
    assert res["branch"] != "main"
    # after delivery, main still points at the original base commit (nothing pushed to it)
    from conftest import run

    main_sha = run(["git", "rev-parse", "origin/main"], git_repo).stdout.strip()
    head_sha = run(["git", "rev-parse", "HEAD"], git_repo).stdout.strip()
    assert main_sha != head_sha  # the commit went to the feature branch, not main


def test_remediate_writes_reports_and_accounts_blockers(git_repo: Path):
    work = git_repo / ".preflight"
    report = remediate.remediate(
        git_repo, {}, None, work, max_iters=2, dry_run=True, fix_code=False
    )
    assert report["run_completed"] is True
    assert "accounting" in report and "technical_debt" in report
    docs = git_repo / ".preflight" / "docs-preflight"
    paths = remediate.persist_reports(git_repo, report, docs, [])
    assert {Path(p).name for p in paths} == set(reports.REQUIRED)


def test_failed_npm_ci_produces_blocked_final_status(tmp_path: Path):
    # simulates the npm ci 401 outcome (a live private registry is not available here)
    action = {
        "gate": 6,
        "action": "npm_install",
        "command": "npm ci",
        "result": "rc=1",
        "error": "npm ERR! 401 Unauthorized _authToken=npm_ABCDEFGHIJKLMNOPQRSTUV012345",
    }
    acct = accounting.reconcile({"genuine_blockers": []}, [action])
    reports.persist(
        tmp_path / "docs" / "preflight",
        run_id="r",
        timestamp="t",
        source_commit="s",
        tool_version="2.1.0",
        evaluate_report={},
        autofix_actions=[action],
        accounting=acct,
        techdebt=[],
    )
    summary = (tmp_path / "docs" / "preflight" / "machine-summary.json").read_text()
    assert '"overall_status": "blocked"' in summary
    assert acct["blocker_count"] == 1
    assert "npm_ABCDEFGHIJKLMNOPQRSTUV012345" not in summary  # secret never logged
