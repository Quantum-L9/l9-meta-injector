"""Shared scanner — recursive walk, skip hidden/system files."""

import os

SKIP_DIRS = {".git", "__pycache__", ".DS_Store", "node_modules", ".idea", ".vscode"}
SKIP_FILES = {".DS_Store", ".gitkeep", ".gitignore"}


def scan(source):
    """Yield (rel_path, abs_path, ext) for every eligible file under source."""
    for root, dirs, names in os.walk(source):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for name in names:
            if name in SKIP_FILES or name.startswith("."):
                continue
            abs_path = os.path.join(root, name)
            rel_path = os.path.relpath(abs_path, source)
            ext = os.path.splitext(name)[1].lower()
            yield rel_path, abs_path, ext
