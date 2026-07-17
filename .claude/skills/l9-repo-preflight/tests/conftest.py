"""Test harness: put scripts/ on the path and provide a git-repo-with-remote fixture."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))


def run(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=str(cwd), capture_output=True, text=True, check=True)


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    """A repo on `main` with a committed base and a bare `origin` remote (push works)."""
    repo = tmp_path / "repo"
    repo.mkdir()
    run(["git", "-c", "init.defaultBranch=main", "init", "-q"], repo)
    run(["git", "config", "user.email", "d@x"], repo)
    run(["git", "config", "user.name", "d"], repo)
    (repo / "README.md").write_text("# demo\n")
    pkg = repo / "pkg"
    pkg.mkdir()
    (pkg / "__init__.py").write_text('"""p"""\n')
    run(["git", "add", "-A"], repo)
    run(["git", "commit", "-qm", "base"], repo)
    run(["git", "branch", "-M", "main"], repo)
    remote = tmp_path / "origin.git"
    run(["git", "init", "--bare", "-q", str(remote)], tmp_path)
    run(["git", "remote", "add", "origin", str(remote)], repo)
    run(["git", "push", "-q", "-u", "origin", "main"], repo)
    return repo
