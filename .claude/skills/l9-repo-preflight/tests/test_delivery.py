"""Integration: git + PR delivery — branch/commit/push/PR, idempotency, no push to main."""

from __future__ import annotations

from pathlib import Path

from conftest import run
from preflight import delivery
from preflight.github import DryRunAdapter


def _intended_change(repo: Path) -> list[str]:
    (repo / "pkg" / "new.py").write_text("x = 1\n")
    return ["pkg/new.py"]


def test_successful_autofix_creates_branch_commit_push_and_pr(git_repo: Path):
    intended = _intended_change(git_repo)
    ad = DryRunAdapter()
    res = delivery.deliver_autofix(
        git_repo, ad, intended, base="main", repo_slug="o/r", dry_run=False, run_id="deadbeef"
    )
    effects = {r["effect"]: r for r in res["receipts"]}
    assert res["branch"] == "preflight/autofix-deadbeef"
    assert effects["commit_created"]["committed"] is True
    assert effects["branch_pushed"]["pushed"] is True
    assert any(i["effect"] == "open_pr" for i in ad.intents)
    # the branch was pushed, NOT main
    assert res["branch"] != "main" and res["branch"].startswith("preflight/")


def test_only_intended_paths_are_committed(git_repo: Path):
    intended = _intended_change(git_repo)
    (git_repo / "unrelated.txt").write_text("noise\n")  # must NOT be committed
    ad = DryRunAdapter()
    delivery.deliver_autofix(git_repo, ad, intended, dry_run=False, run_id="r1")
    files = run(["git", "show", "--name-only", "--format=", "HEAD"], git_repo).stdout.split()
    assert "pkg/new.py" in files
    assert "unrelated.txt" not in files


def test_duplicate_pr_is_not_created(git_repo: Path):
    intended = _intended_change(git_repo)
    ad = DryRunAdapter(state={"prs": {"preflight/autofix-r2": {"number": 3, "url": "u"}}})
    res = delivery.deliver_autofix(
        git_repo, ad, intended, repo_slug="o/r", dry_run=False, run_id="r2"
    )
    assert res["pr"]["reused"] is True
    assert not any(i["effect"] == "open_pr" for i in ad.intents)


def test_no_intended_changes_is_noop(git_repo: Path):
    res = delivery.deliver_autofix(git_repo, DryRunAdapter(), [], dry_run=False)
    assert res["delivered"] is False
