from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from typing import Any

from .models import ToolCapability

TOOLS = {
    "pip-audit": "dependency_vulnerability_scan",
    "npm": "node_dependency_audit",
    "bandit": "python_sast",
    "semgrep": "multi_language_sast",
    "syft": "sbom_generation",
    "actionlint": "workflow_lint",
    "radon": "complexity",
    "jscpd": "duplication",
    "import-linter": "architecture_imports",
    "detect-secrets": "secret_scan",
}


@dataclass(frozen=True)
class VersionProbe:
    value: str
    error: str | None = None


def _version(tool: str) -> VersionProbe:
    try:
        result = subprocess.run(
            [tool, "--version"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return VersionProbe("UNKNOWN", type(exc).__name__)
    value = (result.stdout or result.stderr).strip().splitlines()
    if result.returncode != 0:
        return VersionProbe(value[0][:200] if value else "UNKNOWN", f"exit_{result.returncode}")
    return VersionProbe(value[0][:200] if value else "UNKNOWN")


def discover() -> dict[str, dict[str, Any]]:
    """Detect optional tools once without interpreting absence as a failure."""
    discovered: dict[str, dict[str, Any]] = {}
    for tool, capability in TOOLS.items():
        path = shutil.which(tool)
        probe = _version(tool) if path else VersionProbe("UNKNOWN")
        record = ToolCapability(
            tool=tool,
            capability=capability,
            provider_type="local_cli",
            availability="available" if path else "unavailable",
            reason="resolved_on_path" if path else "executable_not_found",
            version=probe.value,
            execution_supported=bool(path),
        ).as_dict()
        record.update(
            {
                "path": path,
                "supported_version_range": "UNKNOWN",
                "absence_behavior": "not_observed",
                "equivalent_evidence_allowed": True,
                "version_probe_error": probe.error,
            }
        )
        discovered[tool] = record
    return discovered
