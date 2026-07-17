from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .v41 import run as run_v41

VERSIONS = {
    "skill": "4.2",
    "evaluator": "4.2",
    "schema": "4.2",
    "provider": "4.2",
    "gate20": "2.2",
    "repository_intelligence": "1.0",
}


def _default_advertised_capabilities(
    advertised: dict[str, Any] | None,
    *,
    autonomous: bool | None,
) -> dict[str, Any]:
    if advertised is not None:
        return advertised
    inferred_autonomous = autonomous
    if inferred_autonomous is None:
        inferred_autonomous = os.getenv("CI", "").lower() == "true" or os.getenv("GITHUB_ACTIONS", "").lower() == "true"
    return {
        "reasoning_provider": {
            "host_agent_session": not inferred_autonomous,
            "external_provider_configured": False,
            "credentials_available": False,
            "capability_source": "v4.2_default_interactive_host" if not inferred_autonomous else "v4.2_autonomous_static_default",
        },
        "host_agent": {
            "available": not inferred_autonomous,
            "structured_reasoning_callback": not inferred_autonomous,
        },
    }


def run(
    repo: Path,
    mode: str = "filesystem",
    capabilities: set[str] | None = None,
    audit_mode: str = "auto",
    reasoning_provider: Any = None,
    github_provider: Any = None,
    repository: str | None = None,
    pr_number: int | None = None,
    advertised_capabilities: dict[str, Any] | None = None,
    reasoning_response: dict[str, Any] | None = None,
    remediation_allowed: bool = False,
    packaging_requested: bool = False,
    parent_semantic_snapshot: dict[str, Any] | None = None,
    autonomous: bool | None = None,
) -> dict[str, Any]:
    advertised = _default_advertised_capabilities(advertised_capabilities, autonomous=autonomous)
    report = run_v41(
        repo,
        mode=mode,
        capabilities=capabilities,
        audit_mode=audit_mode,
        reasoning_provider=reasoning_provider,
        github_provider=github_provider,
        repository=repository,
        pr_number=pr_number,
        advertised_capabilities=advertised,
        reasoning_response=reasoning_response,
        remediation_allowed=remediation_allowed,
        packaging_requested=packaging_requested,
        parent_semantic_snapshot=parent_semantic_snapshot,
    )
    report["version"] = "4.2"
    report["versions"] = {**report.get("versions", {}), **VERSIONS}
    report["forensic_audit"]["default_reasoning_policy"] = {
        "interactive_default": "host_agent",
        "autonomous_default": "static_only",
        "gate20b_enabled": True,
        "external_credentials_required": False,
    }
    return report
