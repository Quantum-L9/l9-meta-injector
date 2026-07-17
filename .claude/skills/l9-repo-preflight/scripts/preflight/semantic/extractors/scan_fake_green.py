"""Detect 'fake green' CI patterns in GitHub Actions workflows."""
from __future__ import annotations
import re
from pathlib import Path

_WF_GLOB = ".github/workflows"
_CONTINUE_ON_ERR = re.compile(r'continue-on-error\s*:\s*true', re.IGNORECASE)
_OR_TRUE = re.compile(r'\|\|\s*true\b')
_SET_PLUS_E = re.compile(r'\bset\s+\+e\b')
_IF_FALSE = re.compile(r'\bif\s*:\s*false\b', re.IGNORECASE)
_COVERAGE_DISABLED = re.compile(r'(coverage\s*[<>=!]+\s*0|--cov-fail-under=0|min.coverage\s*=\s*0)', re.IGNORECASE)
_EMPTY_MATRIX_INCLUDE = re.compile(r'matrix\s*:\s*\n\s*include\s*:\s*\[\s*\]')
_NOOP_STEP = re.compile(r'run\s*:\s*(?:echo\s+["\'].*["\']|true|:)\s*$')


def scan_workflows(repo: Path) -> list[dict]:
    findings: list[dict] = []
    wf_dir = repo / _WF_GLOB
    if not wf_dir.is_dir():
        return findings
    for p in sorted(wf_dir.glob("*.y*ml")):
        rel = str(p.relative_to(repo))
        try:
            lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
            text = "\n".join(lines)
        except Exception:
            continue
        for i, line in enumerate(lines, 1):
            stripped = line.strip()
            if _CONTINUE_ON_ERR.search(line):
                findings.append({"file": rel, "line": i, "pattern": "continue-on-error", "evidence": stripped[:120]})
            if _OR_TRUE.search(line):
                findings.append({"file": rel, "line": i, "pattern": "or-true-shell", "evidence": stripped[:120]})
            if _SET_PLUS_E.search(line):
                findings.append({"file": rel, "line": i, "pattern": "set+e-disabled", "evidence": stripped[:120]})
            if _IF_FALSE.search(line):
                findings.append({"file": rel, "line": i, "pattern": "if-false-skip", "evidence": stripped[:120]})
            if _COVERAGE_DISABLED.search(line):
                findings.append({"file": rel, "line": i, "pattern": "coverage-gate-disabled", "evidence": stripped[:120]})
            if _NOOP_STEP.search(line):
                findings.append({"file": rel, "line": i, "pattern": "noop-step", "evidence": stripped[:120]})
        if _EMPTY_MATRIX_INCLUDE.search(text):
            findings.append({"file": rel, "line": 0, "pattern": "empty-matrix", "evidence": "matrix.include: []"})
    return findings
