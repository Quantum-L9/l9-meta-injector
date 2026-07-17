"""Evidence-based technical-debt detection.

Only reports debt it can point at with a path (and line where available). Never
invents debt; deduplicates; distinguishes blocking from non-blocking. Debt is
non-blocking by default (it is reported, not a preflight gate) unless a category is
inherently blocking (missing validation entirely).

Categories: TODO/FIXME/HACK markers, deprecated dependencies, stale/duplicate
workflows, skipped/disabled tests, missing validation, unpinned actions.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

_SKIP_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "dist",
    "build",
    ".preflight",
}
_TEXT_EXT = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".sh",
    ".yml",
    ".yaml",
    ".toml",
    ".json",
    ".md",
    ".cfg",
    ".ini",
    ".txt",
}

_MARKER = re.compile(r"\b(TODO|FIXME|HACK|XXX)\b")
_SKIP_TEST = re.compile(
    r"(@pytest\.mark\.skip|@pytest\.mark\.xfail|@unittest\.skip|\.skip\(|\.only\(|xit\(|xdescribe\()"
)
_USES = re.compile(r"^\s*(?:-\s*)?uses:\s*([^\s#]+)")
_SHA40 = re.compile(r"^[0-9a-f]{40}$")
_DEP_FILES = ("requirements.txt", "requirements-ci.txt", "requirements-dev.txt", "package.json")


def _iter_files(repo: Path):  # type: ignore[no-untyped-def]
    for p in sorted(repo.rglob("*")):
        if not p.is_file():
            continue
        if any(seg in _SKIP_DIRS for seg in p.relative_to(repo).parts):
            continue
        if p.suffix in _TEXT_EXT:
            yield p


def _rel(repo: Path, p: Path) -> str:
    return str(p.relative_to(repo))


def _finding(
    category: str, path: str, line: int | None, evidence: str, blocking: bool
) -> dict[str, Any]:
    f: dict[str, Any] = {
        "category": category,
        "path": path,
        "evidence": evidence.strip()[:200],
        "blocking": blocking,
    }
    if line is not None:
        f["line"] = line
    return f


def detect(repo: Path) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    workflow_names: dict[str, list[str]] = {}

    for p in _iter_files(repo):
        rel = _rel(repo, p)
        try:
            lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            continue
        is_test = "test" in p.name.lower() or "/tests/" in ("/" + rel)
        is_workflow = rel.startswith(".github/workflows/")
        is_dep = p.name in _DEP_FILES
        for i, line in enumerate(lines, 1):
            if _MARKER.search(line):
                findings.append(_finding("TODO_FIXME_HACK_markers", rel, i, line, False))
            if is_test and _SKIP_TEST.search(line):
                findings.append(_finding("skipped_or_disabled_tests", rel, i, line, False))
            if is_workflow:
                m = _USES.match(line)
                if m and "@" in m.group(1):
                    ref = m.group(1).rsplit("@", 1)[1]
                    if not _SHA40.match(ref):
                        findings.append(_finding("unpinned_actions", rel, i, line, False))
                if line.strip().startswith("name:") and not workflow_names.get(rel):
                    workflow_names.setdefault(line.split("name:", 1)[1].strip(), []).append(rel)
            if is_dep and "deprecated" in line.lower():
                findings.append(_finding("deprecated_dependencies", rel, i, line, False))

    # duplicate workflow names (same `name:` across >1 file)
    for name, files in workflow_names.items():
        if len(files) > 1:
            findings.append(
                _finding(
                    "stale_or_duplicate_workflows",
                    ", ".join(sorted(files)),
                    None,
                    f"duplicate workflow name: {name}",
                    False,
                )
            )

    # missing validation entirely: no tests dir AND no CI workflows -> blocking debt
    has_tests = (repo / "tests").is_dir() or (repo / "test").is_dir()
    has_ci = (repo / ".github" / "workflows").is_dir() and any(
        (repo / ".github" / "workflows").glob("*.y*ml")
    )
    if not has_tests and not has_ci:
        findings.append(
            _finding(
                "missing_validation",
                ".",
                None,
                "no tests/ directory and no .github/workflows CI present",
                True,
            )
        )

    return _dedupe(findings)


def _dedupe(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen, out = set(), []
    for f in findings:
        key = (f["category"], f["path"], f.get("line"), f["evidence"])
        if key not in seen:
            seen.add(key)
            out.append(f)
    # deterministic ordering
    out.sort(key=lambda f: (f["category"], f["path"], f.get("line") or 0))
    return out
