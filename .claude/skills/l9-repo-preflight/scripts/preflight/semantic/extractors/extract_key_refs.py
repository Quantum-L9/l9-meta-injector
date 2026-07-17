"""Extract config/env key references from Python and TS/JS source."""
from __future__ import annotations
import re
from pathlib import Path

_PY_GETENV = re.compile(r'os\.(?:environ\.get|getenv)\(\s*["\']([A-Z0-9_]+)["\']')
_PY_ENVIRON = re.compile(r'os\.environ\[["\']([A-Z0-9_]+)["\']\]')
_TS_PROCESS = re.compile(r'process\.env\.([A-Z0-9_]+)')
_TS_BRACKET = re.compile(r'process\.env\[["\']([A-Z0-9_]+)["\']\]')
_ENV_LINE = re.compile(r'^([A-Z0-9_]{2,})\s*=')
_SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", ".preflight"}


def extract_referenced(repo: Path) -> set[str]:
    refs: set[str] = set()
    for p in sorted(repo.rglob("*")):
        if not p.is_file() or any(s in _SKIP_DIRS for s in p.relative_to(repo).parts):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if p.suffix == ".py":
            refs.update(_PY_GETENV.findall(text))
            refs.update(_PY_ENVIRON.findall(text))
        elif p.suffix in {".ts", ".tsx", ".js", ".jsx"}:
            refs.update(_TS_PROCESS.findall(text))
            refs.update(_TS_BRACKET.findall(text))
    return refs


def extract_provided(repo: Path) -> set[str]:
    provided: set[str] = set()
    for pattern in ("**/.env*", "**/config.yaml", "**/config.yml", "**/secrets.yaml"):
        for p in repo.glob(pattern):
            if not p.is_file() or any(s in _SKIP_DIRS for s in p.relative_to(repo).parts):
                continue
            try:
                for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                    m = _ENV_LINE.match(line.strip())
                    if m:
                        provided.add(m.group(1))
            except Exception:
                continue
    return provided
