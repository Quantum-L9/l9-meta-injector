"""Extract declared HTTP routes from Python and TS/JS source."""
from __future__ import annotations
import re
from pathlib import Path

_SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", ".preflight"}
_PY_DECORATOR = re.compile(r'@\w+\.(get|post|put|patch|delete|route)\(\s*["\']([^"\']+)["\']', re.IGNORECASE)
_TS_METHOD = re.compile(r'\b(?:app|router|server)\.(get|post|put|patch|delete)\(\s*["\`]([^"\'`]+)["\`]', re.IGNORECASE)
_NEXT_EXPORT = re.compile(r'export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b')


def extract_declared_routes(repo: Path) -> list[dict]:
    routes: list[dict] = []
    for p in sorted(repo.rglob("*")):
        if not p.is_file() or any(s in _SKIP_DIRS for s in p.relative_to(repo).parts):
            continue
        rel = str(p.relative_to(repo))
        try:
            lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            continue
        if p.suffix == ".py":
            for i, line in enumerate(lines, 1):
                for m in _PY_DECORATOR.finditer(line):
                    routes.append({"method": m.group(1).upper(), "path": m.group(2), "file": rel, "line": i})
        elif p.suffix in {".ts", ".tsx", ".js", ".jsx"}:
            for i, line in enumerate(lines, 1):
                for m in _TS_METHOD.finditer(line):
                    routes.append({"method": m.group(1).upper(), "path": m.group(2), "file": rel, "line": i})
                if "app/" in rel or "pages/api/" in rel:
                    for m in _NEXT_EXPORT.finditer(line):
                        routes.append({"method": m.group(1).upper(),
                                       "path": rel.replace("app/", "/").replace("route.ts", ""),
                                       "file": rel, "line": i})
    return routes
