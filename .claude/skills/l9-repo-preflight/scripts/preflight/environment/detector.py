from __future__ import annotations

import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from ..tools.registry import discover as discover_tools

PACKAGE_MAP = {
    "PyYAML": "yaml",
    "jsonschema": "jsonschema",
    "pytest": "pytest",
    "ruff": "ruff",
    "mypy": "mypy",
    "tree-sitter": "tree_sitter",
    "tree-sitter-python": "tree_sitter_python",
    "tree-sitter-javascript": "tree_sitter_javascript",
    "tree-sitter-typescript": "tree_sitter_typescript",
    "tree-sitter-bash": "tree_sitter_bash",
}
RUNTIME = ("PyYAML", "jsonschema")
DEVELOPMENT = ("pytest", "ruff", "mypy")
PARSER_DEPENDENCIES = ("tree-sitter", "tree-sitter-python", "tree-sitter-javascript", "tree-sitter-typescript", "tree-sitter-bash")


def _package(distribution: str) -> dict[str, Any]:
    import_name = PACKAGE_MAP[distribution]
    try:
        available = importlib.util.find_spec(import_name) is not None
    except (ImportError, AttributeError, ValueError) as exc:
        return {"available": False, "version": "UNKNOWN", "error": type(exc).__name__}
    if not available:
        return {"available": False, "version": "UNKNOWN"}
    try:
        package_version = version(distribution)
    except PackageNotFoundError:
        package_version = "UNKNOWN"
    return {"available": True, "version": package_version, "import_name": import_name}


def _command_version(command: str) -> str:
    try:
        result = subprocess.run(
            [command, "--version"], capture_output=True, text=True, timeout=3, check=False
        )
    except (OSError, subprocess.SubprocessError):
        return "UNKNOWN"
    lines = (result.stdout or result.stderr).strip().splitlines()
    return lines[0][:200] if lines else "UNKNOWN"


def _probe_write(path: Path) -> tuple[bool, str | None]:
    """Probe an existing directory without creating target-repository paths."""
    if not path.exists() or not path.is_dir():
        return False, "directory_unavailable"
    try:
        with tempfile.NamedTemporaryFile(dir=path, prefix=".preflight-write-probe-", delete=True):
            return True, None
    except OSError as exc:
        return False, type(exc).__name__


def detect_environment(
    repo: Path,
    mode: str = "filesystem",
    advertised: dict[str, Any] | None = None,
    tool_capabilities: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    advertised = advertised or {}
    repo = repo.resolve()
    python_version = (sys.version_info.major, sys.version_info.minor, sys.version_info.micro)
    git_path = shutil.which("git")
    git_repository = (repo / ".git").exists()
    optional_tools = tool_capabilities if tool_capabilities is not None else discover_tools()
    repo_write, repo_write_error = _probe_write(repo)
    temp_write, temp_write_error = _probe_write(Path(tempfile.gettempdir()))

    mcp = advertised.get(
        "mcp_bridge",
        {"state": "unavailable", "python_subprocess_access": False, "supported_operations": []},
    )
    github = advertised.get("github_provider", {"authentication_state": "unknown", "operations": {}})
    reasoning = advertised.get(
        "reasoning_provider",
        {
            "host_agent_session": False,
            "external_provider_configured": False,
            "credentials_available": "unknown",
        },
    )
    report: dict[str, Any] = {
        "schema_version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "execution_environment": {
            "python": {
                "available": True,
                "version": ".".join(map(str, python_version)),
                "minimum_supported_version": "3.11",
                "runtime_dependencies": {**{name: _package(name) for name in RUNTIME}, "yaml": _package("PyYAML")},
                "development_dependencies": {name: _package(name) for name in DEVELOPMENT},
                "optional_dependencies": optional_tools,
                "parser_dependencies": {name: _package(name) for name in PARSER_DEPENDENCIES},
            },
            "filesystem": {
                "recursive_read": repo.exists() and os.access(repo, os.R_OK),
                "file_metadata": repo.exists(),
                "write_observable": repo_write if mode == "filesystem" else False,
                "write": repo_write if mode == "filesystem" else False,
                "write_authorized": bool(advertised.get("filesystem", {}).get("write_authorized", False)),
                "temporary_directory": temp_write,
                "create_archive": temp_write,
                "detection_errors": [
                    error
                    for error in (repo_write_error if mode == "filesystem" else None, temp_write_error)
                    if error
                ],
            },
            "git": {
                "available": bool(git_path),
                "version": _command_version("git") if git_path else "UNKNOWN",
                "repository_detected": git_repository,
                "worktree_access": bool(git_path and git_repository),
                "dirty_tree_observable": bool(git_path and git_repository),
                "diff_observable": bool(git_path and git_repository),
                "write_authorized": bool(advertised.get("git", {}).get("write_authorized", False)),
            },
            "mcp_bridge": mcp,
            "github_provider": github,
            "reasoning_provider": reasoning,
            "parsers": {
                "python_ast": {"support": "native", "depth": "deep", "dependency": "standard_library"},
                "python_tree_sitter": {"support": "structural_fallback", "dependency": "tree-sitter-python", "available": _package("tree-sitter-python")["available"]},
                "yaml": {"support": "structured"},
                "json": {"support": "structured"},
                "javascript": {"support": "limited", "dependency": "tree-sitter-javascript", "available": _package("tree-sitter-javascript")["available"]},
                "typescript": {"support": "limited", "dependency": "tree-sitter-typescript", "available": _package("tree-sitter-typescript")["available"]},
                "shell": {"support": "contextual_text", "dependency": "tree-sitter-bash", "available": _package("tree-sitter-bash")["available"]},
            },
            "network": {"available": "unverified", "detection_method": "no_external_probe"},
            "archives": {
                "input_formats": ["zip", "tar", "tar.gz"],
                "output_formats": ["zip"],
                "safety": [
                    "path_traversal_protection",
                    "explicit_symlink_policy",
                    "extracted_size_limit",
                    "file_count_limit",
                ],
            },
            "host_agent": advertised.get(
                "host_agent", {"available": "unknown", "obligations_verified": False}
            ),
            "platform": {
                "system": platform.system(),
                "release": platform.release(),
                "tested_status": "tested" if platform.system() == "Linux" else "UNVERIFIED",
                "shell_support": "native" if platform.system() in ("Linux", "Darwin") else "limited",
                "known_limitations": []
                if platform.system() == "Linux"
                else ["platform_not_in_executed_test_matrix"],
            },
        },
        "capability_limitations": [],
        "provenance": [{"source": "runtime_detection", "mode": mode}],
        "redaction_status": {"secrets_included": False, "credential_values_probed": False},
        "detection_errors": [],
    }
    if python_version[:2] < (3, 11):
        report["capability_limitations"].append("python_below_minimum")
    if mode == "connector":
        report["capability_limitations"].extend(
            ["filesystem_write_unavailable", "local_git_state_not_authoritative"]
        )
    if not reasoning.get("host_agent_session") and not reasoning.get("external_provider_configured"):
        report["capability_limitations"].append("reasoning_provider_unavailable")
    report["environment_fingerprint"] = stable_fingerprint(report)
    return report


def stable_fingerprint(report: dict[str, Any]) -> str:
    import hashlib

    stable = json.loads(json.dumps(report))
    stable.pop("generated_at", None)
    stable.pop("environment_fingerprint", None)
    return hashlib.sha256(
        json.dumps(stable, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
