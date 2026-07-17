"""Git + pull-request delivery of successful autofixes.

Separated from remediation: given the set of files the autofix INTENDED to change,
detect the actual worktree changes among them (excluding anything unrelated),
create a deterministic branch, commit only those changes with a run reference,
push, and open a PR against the base branch via the replaceable GitHub adapter.

Idempotent: the branch name is a hash of (base_sha + normalized change set), so
identical repairs reuse the same branch/PR instead of duplicating. Every effect
returns a captured receipt; dry-run performs no push and no PR.
"""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path
from typing import Any

from .github import GitHubAdapter

PR_TITLE = "fix(preflight): apply automated repository repairs"
CI_PR_TITLE = "ci: adopt canonical l9-ci-core pipeline"


def _git(args: list[str], repo: Path) -> tuple[int, str]:
    p = subprocess.run(["git", *args], cwd=str(repo), capture_output=True, text=True, check=False)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def _changed(repo: Path, paths: list[str]) -> list[str]:
    """The intended paths that actually differ in the worktree/index."""
    rc, out = _git(["status", "--porcelain", "--", *paths], repo) if paths else (0, "")
    changed = []
    for line in out.splitlines():
        if len(line) >= 4:
            changed.append(line[3:].strip())
    return (
        sorted(set(changed) & set(paths))
        if paths
        else sorted({line[3:].strip() for line in out.splitlines()})
    )


def normalized_change_set(repo: Path, paths: list[str]) -> list[str]:
    rc, out = _git(["status", "--porcelain", "--", *paths], repo) if paths else (0, "")
    return sorted(line.strip() for line in out.splitlines() if line.strip())


def autofix_run_id(base_sha: str, change_set: list[str]) -> str:
    h = hashlib.sha256((base_sha + "\n" + "\n".join(sorted(change_set))).encode()).hexdigest()
    return h[:12]


def _branch_exists(repo: Path, branch: str) -> bool:
    rc, _ = _git(["rev-parse", "--verify", "--quiet", f"refs/heads/{branch}"], repo)
    return rc == 0


def deliver_autofix(
    repo: Path,
    adapter: GitHubAdapter,
    intended_paths: list[str],
    *,
    base: str = "main",
    repo_slug: str = "",
    dry_run: bool = True,
    run_id: str | None = None,
) -> dict[str, Any]:
    """Create branch → commit intended changes → push → open PR. Idempotent."""
    receipts: list[dict[str, Any]] = []
    changed = _changed(repo, intended_paths)
    if not changed:
        return {"delivered": False, "reason": "no intended worktree changes", "receipts": receipts}

    base_sha = _git(["rev-parse", "HEAD"], repo)[1].strip()
    change_set = normalized_change_set(repo, intended_paths)
    rid = run_id or autofix_run_id(base_sha, change_set)
    branch = f"preflight/autofix-{rid}"

    reused_branch = _branch_exists(repo, branch)
    if not reused_branch:
        _git(["switch", "-c", branch], repo)
    else:
        _git(["switch", branch], repo)
    receipts.append(
        {"effect": "branch_created", "branch": branch, "reused": reused_branch, "dry_run": dry_run}
    )

    # stage ONLY the intended paths (exclude unrelated worktree changes)
    _git(["add", "--", *changed], repo)
    msg = f"{PR_TITLE}\n\npreflight-run: {rid}\nbase: {base_sha}"
    rc_commit, _ = _git(["commit", "-m", msg], repo)
    committed = rc_commit == 0
    receipts.append(
        {"effect": "commit_created", "committed": committed, "run_id": rid, "files": changed}
    )

    pushed = False
    if not dry_run:
        rc_push, _ = _git(["push", "-u", "origin", branch], repo)
        pushed = rc_push == 0
    receipts.append({"effect": "branch_pushed", "pushed": pushed, "dry_run": dry_run})

    existing = adapter.find_pr(repo_slug, branch) if repo_slug else None
    if existing:
        pr = {"reused": True, **existing}
    else:
        body = (
            f"Automated repository repairs from preflight run `{rid}`.\n\n"
            f"See `docs/preflight/` for the full report and autofix log."
        )
        pr = adapter.open_pr(repo_slug, branch, base, PR_TITLE, body)
    receipts.append(
        {
            "effect": "pull_request_created_or_reused",
            "reused": bool(existing),
            "dry_run": adapter.dry_run,
        }
    )

    return {
        "delivered": committed or reused_branch,
        "run_id": rid,
        "branch": branch,
        "base": base,
        "pr": pr,
        "receipts": receipts,
    }


def deliver_ci_migration(
    repo: Path,
    adapter: GitHubAdapter,
    caller_content: str,
    target_path: str,
    *,
    base: str = "main",
    repo_slug: str = "",
    dry_run: bool = True,
    run_id: str = "",
) -> dict[str, Any]:
    """Separate branch + PR for the CI changeover (never mixed with autofix)."""
    receipts: list[dict[str, Any]] = []
    branch = f"ci/adopt-l9-ci-core-{run_id}"
    reused = _branch_exists(repo, branch)
    _git(["switch", "-c", branch] if not reused else ["switch", branch], repo)
    (repo / target_path).parent.mkdir(parents=True, exist_ok=True)
    (repo / target_path).write_text(caller_content, encoding="utf-8")
    _git(["add", "--", target_path], repo)
    rc, _ = _git(["commit", "-m", f"{CI_PR_TITLE}\n\npreflight-run: {run_id}"], repo)
    receipts.append({"effect": "commit_created", "committed": rc == 0, "files": [target_path]})
    pushed = False
    if not dry_run:
        pushed = _git(["push", "-u", "origin", branch], repo)[0] == 0
    receipts.append({"effect": "branch_pushed", "pushed": pushed, "dry_run": dry_run})
    existing = adapter.find_pr(repo_slug, branch) if repo_slug else None
    pr = (
        {"reused": True, **existing}
        if existing
        else adapter.open_pr(
            repo_slug,
            branch,
            base,
            CI_PR_TITLE,
            "Adopt the canonical l9-ci-core reusable pipeline.",
        )
    )
    receipts.append(
        {
            "effect": "pull_request_created_or_reused",
            "reused": bool(existing),
            "dry_run": adapter.dry_run,
        }
    )
    return {"delivered": rc == 0 or reused, "branch": branch, "pr": pr, "receipts": receipts}
