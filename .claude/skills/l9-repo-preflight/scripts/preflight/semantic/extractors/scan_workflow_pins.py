"""Detect unpinned GitHub Actions `uses:` references."""
from __future__ import annotations
import re
from pathlib import Path

_SHA40 = re.compile(r"^[0-9a-f]{40}$")
_USES = re.compile(r"^\s*(?:-\s*)?uses:\s*([^\s#]+)")
_LOCAL = re.compile(r"^\./")


def scan_unpinned(repo: Path) -> list[dict]:
    findings: list[dict] = []
    wf_dir = repo / ".github" / "workflows"
    if not wf_dir.is_dir():
        return findings
    for p in sorted(wf_dir.glob("*.y*ml")):
        rel = str(p.relative_to(repo))
        try:
            lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            continue
        for i, line in enumerate(lines, 1):
            m = _USES.match(line)
            if not m:
                continue
            ref = m.group(1).strip()
            if _LOCAL.match(ref):
                continue
            if "@" not in ref:
                findings.append({"file": rel, "line": i, "action_ref": ref, "tag": None, "sha": None})
                continue
            action, pin = ref.rsplit("@", 1)
            if not _SHA40.match(pin):
                findings.append({"file": rel, "line": i, "action_ref": ref, "tag": pin, "sha": None})
    return findings
