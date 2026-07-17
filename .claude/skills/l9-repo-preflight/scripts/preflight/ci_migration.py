"""Reusable-CI changeover: replace a local pipeline with a thin reusable caller.

Detects whether the current repository still contains a local CI implementation
that should delegate to the canonical l9-ci-core reusable workflow, generates the
thin caller for `.github/workflows/ci.yml`, and validates it. The reusable ref is
the canonical pipeline (pinned to an exact SHA) — that is the CI core, not a
consumer repo, so it is intentionally fixed; no consumer repo name is hardcoded.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

REUSABLE_REF = (
    "Quantum-L9/l9-ci-core/.github/workflows/pr-pipeline.yml"
    "@102c9a5960c53c607216d320339e0457046948cb"
)
CI_TARGET_PATH = ".github/workflows/ci.yml"

CALLER = """name: CI

on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  ci:
    uses: Quantum-L9/l9-ci-core/.github/workflows/pr-pipeline.yml@102c9a5960c53c607216d320339e0457046948cb
    secrets: inherit
"""

_LOCAL_JOB = re.compile(r"^\s+(runs-on|steps):", re.M)
_SHA_REF = re.compile(r"@[0-9a-f]{40}\s*$")


def _looks_local(text: str) -> bool:
    """A local pipeline has runs-on/steps; a thin caller has neither (only `uses`)."""
    return bool(_LOCAL_JOB.search(text)) and "uses:" not in text.split("jobs:", 1)[-1]


def detect(repo: Path) -> dict[str, Any]:
    wf_dir = repo / ".github" / "workflows"
    ci = repo / CI_TARGET_PATH
    already = False
    local_workflows: list[str] = []
    if ci.exists():
        text = ci.read_text(encoding="utf-8", errors="ignore")
        already = "uses:" in text and "secrets: inherit" in text and not _LOCAL_JOB.search(text)
    if wf_dir.is_dir():
        for f in sorted(wf_dir.glob("*.y*ml")):
            if _looks_local(f.read_text(encoding="utf-8", errors="ignore")):
                local_workflows.append(str(f.relative_to(repo)))
    applicable = (not already) and (ci.exists() or bool(local_workflows))
    return {
        "applicable": applicable,
        "already_migrated": already,
        "local_workflows": local_workflows,
        "target_path": CI_TARGET_PATH,
        "reusable_ref": REUSABLE_REF,
    }


def generate() -> str:
    return CALLER


def validate(content: str) -> list[str]:
    """Return a list of validation errors (empty = valid)."""
    errors: list[str] = []
    try:
        import yaml  # type: ignore[import-not-found]

        doc = yaml.safe_load(content)
    except ImportError:
        doc = None
    except Exception as exc:  # noqa: BLE001
        return [f"yaml does not parse: {exc}"]

    if doc is not None:
        jobs = doc.get("jobs", {})
        if list(jobs) != ["ci"]:
            errors.append("caller must define exactly one job named 'ci'")
        ci = jobs.get("ci", {}) if isinstance(jobs, dict) else {}
        if "runs-on" in ci or "steps" in ci:
            errors.append("caller job must contain no local jobs (no runs-on/steps)")
        if not str(ci.get("uses", "")).endswith("102c9a5960c53c607216d320339e0457046948cb"):
            errors.append("reusable workflow ref must be the exact pinned SHA")
        if ci.get("secrets") != "inherit":
            errors.append("secrets: inherit must be present")
        on = doc.get(True, doc.get("on", {}))  # PyYAML parses bare `on:` as True
        pr = (on or {}).get("pull_request", {}) if isinstance(on, dict) else {}
        if "main" not in (pr or {}).get("branches", []):
            errors.append("main must be a target branch")
    else:  # structural fallback without PyYAML
        if "jobs:" not in content or "ci:" not in content:
            errors.append("caller must define a ci job")
    uses_lines = "".join(ln for ln in content.splitlines() if "uses:" in ln)
    if not _SHA_REF.search(uses_lines):
        errors.append("reusable workflow ref is not pinned to an exact SHA")
    if "secrets: inherit" not in content:
        errors.append("secrets: inherit missing")
    return sorted(set(errors))
