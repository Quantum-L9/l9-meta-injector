"""Integration: PR monitoring bounded repair + CI-migration isolation."""

from __future__ import annotations

from pathlib import Path

from conftest import run
from preflight import ci_migration, delivery, monitor
from preflight.github import DryRunAdapter


class _SeqAdapter(DryRunAdapter):
    """Yields a scripted sequence of PR statuses to drive the monitor loop."""

    def __init__(self, statuses):
        super().__init__()
        self._statuses = list(statuses)

    def pr_status(self, repo, number):
        return self._statuses.pop(0) if self._statuses else {"status": "green"}


def test_pr_monitoring_applies_bounded_repair():
    ad = _SeqAdapter(
        [{"status": "failing", "failures": [{"category": "lint"}]}, {"status": "green"}]
    )
    calls = []
    res = monitor.monitor(ad, "o/r", 1, lambda cats: calls.append(cats) or True, max_cycles=5)
    assert res["terminal_state"] == monitor.READY
    assert calls == [["lint"]]  # one bounded repair, then green


def test_external_blocker_stops_repair():
    ad = _SeqAdapter([{"status": "failing", "failures": [{"category": "missing_credentials"}]}])
    res = monitor.monitor(ad, "o/r", 1, lambda cats: True, max_cycles=5)
    assert res["terminal_state"] == monitor.BLOCKED_EXTERNAL
    assert "missing_credentials" in res["escalated"]


def test_protected_action_requires_approval():
    ad = _SeqAdapter(
        [{"status": "failing", "failures": [{"category": "destructive_or_protected_actions"}]}]
    )
    res = monitor.monitor(ad, "o/r", 1, lambda cats: True)
    assert res["terminal_state"] == monitor.PROTECTED


def test_repair_cycle_limit_reached():
    ad = _SeqAdapter([{"status": "failing", "failures": [{"category": "lint"}]}] * 10)
    res = monitor.monitor(ad, "o/r", 1, lambda cats: True, max_cycles=3)
    assert res["terminal_state"] == monitor.CYCLE_LIMIT
    assert res["cycles"] == 3


def test_ci_migration_generates_valid_caller():
    content = ci_migration.generate()
    assert ci_migration.validate(content) == []
    assert "102c9a5960c53c607216d320339e0457046948cb" in content
    assert "secrets: inherit" in content


def test_ci_migration_isolated_in_separate_branch_and_pr(git_repo: Path):
    # a local pipeline exists -> migration applicable
    wf = git_repo / ".github" / "workflows"
    wf.mkdir(parents=True)
    (wf / "ci.yml").write_text(
        "name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n"
        "    steps:\n      - run: echo hi\n"
    )
    run(["git", "add", "-A"], git_repo)
    run(["git", "commit", "-qm", "add local ci"], git_repo)
    det = ci_migration.detect(git_repo)
    assert det["applicable"] is True
    ad = DryRunAdapter()
    res = delivery.deliver_ci_migration(
        git_repo,
        ad,
        ci_migration.generate(),
        det["target_path"],
        base="main",
        repo_slug="o/r",
        dry_run=False,
        run_id="cimig1",
    )
    assert res["branch"] == "ci/adopt-l9-ci-core-cimig1"
    assert res["branch"].startswith("ci/") and "autofix" not in res["branch"]
