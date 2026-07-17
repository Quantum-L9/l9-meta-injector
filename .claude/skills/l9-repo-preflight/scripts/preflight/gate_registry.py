from __future__ import annotations

from pathlib import Path
from typing import Any

from .agents import gate19_prompt
from .data import gate17_data_safety
from .gates.model import EvidenceState, Finding, GateResult, GateSpec
from .quality import gate18_quality
from .reliability import gate16_sre
from .security import gate15_security

REGISTRY = {
    15: GateSpec(
        15,
        "security-supply-chain",
        "security",
        True,
        ("dependency_management",),
        ("dependency_vulnerability_scan", "static_analysis", "sbom_generation", "secret_scan"),
        ("repository_tree", "tool_registry"),
        ("readable_repository",),
    ),
    16: GateSpec(
        16,
        "service-reliability",
        "reliability",
        False,
        ("deployable_service",),
        ("health_probe_execution",),
        ("semantic_index", "repository_tree"),
    ),
    17: GateSpec(
        17,
        "data-safety",
        "data",
        True,
        ("data_persistence",),
        ("migration_parser",),
        ("semantic_index", "repository_tree"),
    ),
    18: GateSpec(
        18,
        "quality-maintainability",
        "quality",
        False,
        (),
        ("complexity_analysis", "duplicate_code_analysis", "import_boundary_analysis"),
        ("repository_tree", "tool_registry"),
    ),
    19: GateSpec(
        19,
        "prompt-tool-contracts",
        "agents",
        False,
        ("agent_prompts",),
        ("prompt_parser",),
        ("semantic_index", "documents"),
    ),
}
MODULES = {
    15: gate15_security,
    16: gate16_sre,
    17: gate17_data_safety,
    18: gate18_quality,
    19: gate19_prompt,
}


def _capabilities(evidence: dict[str, Any], ast_facts: dict[str, Any]) -> set[str]:
    capabilities: set[str] = set()
    files = set(evidence.get("files", []))
    if {"pyproject.toml", "requirements.txt", "package.json"} & files:
        capabilities.add("dependency_management")
    semantic = ast_facts.get('semantic_index', {})
    routes = [fact for fact in semantic.get('facts', []) if fact.get('kind') == 'route']
    decorators = [decorator for file in ast_facts.get('files', []) for decorator in file.get('decorators', [])]
    legacy_routes = any(decorator.get('name','').endswith(('.get','.post','.put','.patch','.delete')) for decorator in decorators)
    if routes or legacy_routes or any(path in files for path in ('Dockerfile', 'docker-compose.yml')):
        capabilities.add("deployable_service")
    if any("migration" in path.lower() or path.endswith(".sql") for path in files):
        capabilities.add("data_persistence")
    if any(
        path.endswith(".md") and "# Role" in evidence.get("texts", {}).get(path, "")
        for path in files
    ):
        capabilities.add("agent_prompts")
    return capabilities


def _crash_finding(spec: GateSpec, exc: Exception) -> dict[str, Any]:
    status = "requires_human_review" if spec.mandatory else "warning"
    return Finding(
        id=f"G{spec.gate_id}-INTERNAL-ERROR",
        gate_id=spec.gate_id,
        gate_name=spec.name,
        domain=spec.domain,
        claim=f"gate execution failed with {type(exc).__name__}",
        severity="high" if spec.mandatory else "medium",
        status=status,
        confidence=1.0,
        evidence={"exception_type": type(exc).__name__, "message": str(exc)[:500]},
        evidence_state=EvidenceState.OBSERVED,
        inference_type="runtime_exception",
        false_positive_risk="low",
        remediation_id_or_recommended_change="repair gate implementation and rerun",
        autofixable=False,
        provenance=[{"source": "gate_registry", "gate_id": spec.gate_id}],
    ).as_dict()


def run(
    repo: Path,
    evidence: dict[str, Any],
    tools: dict[str, dict[str, Any]],
    ast_facts: dict[str, Any],
    policy: dict[str, Any],
    environment: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    del environment
    capabilities = _capabilities(evidence, ast_facts)
    results: list[dict[str, Any]] = []
    for gate_id, spec in REGISTRY.items():
        gate_policy = policy["gates"].get(str(gate_id), {})
        if not gate_policy.get("enabled", True):
            results.append(
                GateResult(
                    gate_id,
                    spec.name,
                    "not_applicable",
                    False,
                    [],
                    list(spec.evidence_requirements),
                    list(spec.execution_requirements),
                    "disabled by policy",
                ).as_dict()
            )
            continue
        applicable = not spec.required_capabilities or bool(set(spec.required_capabilities) & capabilities)
        if not applicable:
            results.append(
                GateResult(
                    gate_id,
                    spec.name,
                    "not_applicable",
                    False,
                    [],
                    list(spec.evidence_requirements),
                    list(spec.execution_requirements),
                    "repository capability not detected",
                ).as_dict()
            )
            continue
        try:
            findings = MODULES[gate_id].evaluate(repo, evidence, tools, ast_facts)
            reason = "evaluated from capability, policy, and evidence"
        except Exception as exc:
            findings = [_crash_finding(spec, exc)]
            reason = "gate execution failed; canonical crash finding emitted"
        statuses = {finding["status"] for finding in findings}
        if "blocker" in statuses:
            status = "blocker"
        elif "requires_human_review" in statuses:
            status = "requires_human_review"
        elif statuses & {"warning", "contradicted"}:
            status = "warning"
        elif findings and statuses == {"not_observed"}:
            status = "not_observed"
        else:
            status = "clear"
        results.append(
            GateResult(
                gate_id,
                spec.name,
                status,
                True,
                findings,
                list(spec.evidence_requirements),
                list(spec.execution_requirements),
                reason,
                evidence={
                    "required_capabilities": list(spec.required_capabilities),
                    "optional_capabilities": list(spec.optional_capabilities),
                    "absence_behavior": spec.absence_behavior,
                    "degraded_mode": spec.degraded_mode,
                },
            ).as_dict()
        )
    return results
