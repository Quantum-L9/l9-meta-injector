"""Extract feature-flag definitions and references."""
from __future__ import annotations
import re
from pathlib import Path

_SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", ".preflight"}
_PY_FLAG_REF = re.compile(r'(?:is_enabled|flag(?:s)?\.(?:get|is_enabled|check))\s*\(\s*["\']([^"\']+)["\']')
_TS_FLAG_REF = re.compile(r'(?:isEnabled|getFlag|flag(?:Value)?)\s*\(\s*["\`]([^"\'`]+)["\`]')
_ENV_FF = re.compile(r'\b(FF_[A-Z0-9_]+)\b')
_YAML_FLAG_KEY = re.compile(r'^([a-z_][a-z0-9_]*)\s*:\s*(true|false|enabled|disabled)', re.IGNORECASE)


def extract_flag_definitions(repo: Path) -> set[str]:
    defs: set[str] = set()
    for pattern in ("**/flags.yaml", "**/flags.yml", "**/feature_flags.yaml", "**/features.yaml", "**/.flags.yaml"):
        for p in repo.glob(pattern):
            if not p.is_file() or any(s in _SKIP_DIRS for s in p.relative_to(repo).parts):
                continue
            try:
                for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                    m = _YAML_FLAG_KEY.match(line.strip())
                    if m:
                        defs.add(m.group(1))
            except Exception:
                continue
    return defs


def extract_flag_references(repo: Path) -> set[str]:
    refs: set[str] = set()
    for p in sorted(repo.rglob("*")):
        if not p.is_file() or any(s in _SKIP_DIRS for s in p.relative_to(repo).parts):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if p.suffix == ".py":
            refs.update(_PY_FLAG_REF.findall(text))
            refs.update(_ENV_FF.findall(text))
        elif p.suffix in {".ts", ".tsx", ".js", ".jsx"}:
            refs.update(_TS_FLAG_REF.findall(text))
            refs.update(_ENV_FF.findall(text))
    return refs
