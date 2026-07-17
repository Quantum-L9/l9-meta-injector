#!/usr/bin/env python3
"""Validate the skill pack manifest against file size and SHA-256 digests."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def validate(manifest_path: Path) -> list[str]:
    root = manifest_path.parent
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    expected = {item["path"]: item for item in data.get("files", [])}
    actual = {
        str(path.relative_to(root)).replace("\\", "/"): path
        for path in root.rglob("*")
        if path.is_file() and path != manifest_path and ".pytest_cache" not in path.parts and "__pycache__" not in path.parts
    }
    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    if missing:
        errors.append(f"missing files: {missing}")
    if extra:
        errors.append(f"unmanifested files: {extra}")
    for rel in sorted(set(expected) & set(actual)):
        item, path = expected[rel], actual[rel]
        size = path.stat().st_size
        sha = digest(path)
        if item.get("size") != size:
            errors.append(f"size mismatch: {rel}")
        if item.get("sha256") != sha:
            errors.append(f"sha256 mismatch: {rel}")
    if data.get("file_count") != len(expected):
        errors.append("file_count mismatch")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", nargs="?", default="manifest.json")
    args = parser.parse_args()
    errors = validate(Path(args.manifest).resolve())
    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1
    print("PASS: manifest file set, sizes, and SHA-256 digests are valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
