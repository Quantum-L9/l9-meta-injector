from __future__ import annotations

from pathlib import Path
from typing import Any

from .gates.archetype import evaluate as evaluate_archetype_gates
from .gates.universal import evaluate as evaluate_universal_gates
from .probe.capability_detector import detect as detect_capabilities
from .probe.contradiction_detector import detect as detect_contradictions
from .probe.evidence_collector import collect
from .probe.execution_context import establish
from .probe.repository_profiler import infer
from .semantic.action_reference_analyzer import analyze as analyze_actions
from .semantic.enforcement_coverage import analyze as analyze_enforcement
from .semantic.suppression_analyzer import analyze as analyze_suppressions
from .semantic.workflow_semantics import load_workflows

VERSIONS = {
    "skill": "3.5",
    "evaluator": "3.5",
    "schema": "3.5",
    "provider": "3.3",
}


def _finding(
    *,
    finding_id: str,
    claim: str,
    severity: str,
    status: str,
    confidence: float,
    evidence: dict[str, Any],
    inference_type: str,
    false_positive_risk: str,
    remediation: str,
    gate_id: int | None = None,
    gate_name: str | None = None,
    domain: str | None = None,
) -> dict[str, Any]:
    return {
        "id": finding_id,
        "gate_id": gate_id,
        "gate_name": gate_name,
        "domain": domain,
        "claim": claim,
        "severity": severity,
        "status": status,
        "confidence": confidence,
        "evidence": evidence,
        "inference_type": inference_type,
        "false_positive_risk": false_positive_risk,
        "remediation_id_or_recommended_change": remediation,
    }


def _gate_by_id(gates: list[dict[str, Any]], gate_id: str) -> dict[str, Any]:
    return next(item for item in gates if item["id"] == gate_id)


def _wire_semantics_into_universal_gates(
    gates: list[dict[str, Any]],
    semantic_analysis: dict[str, Any],
) -> None:
    """Make U07/U08 reflect the semantic verdicts they claim to summarize."""
    u07 = _gate_by_id(gates, "U07")
    suppressions = semantic_analysis["suppressions"]
    enforcement = semantic_analysis["enforcement_coverage"]
    blockers = [item for item in suppressions if item["status"] == "blocker"]
    reviews = [item for item in suppressions if item["status"] == "requires_human_review"]
    if blockers:
        u07["status"] = "blocker"
        u07["reason"] = "validation suppression can make CI report success after a failed check"
    elif enforcement["status"] == "warning" or reviews:
        u07["status"] = "warning" if not reviews else "requires_human_review"
        u07["reason"] = "CI enforcement coverage is incomplete or ambiguous"
    else:
        u07["status"] = "clear"
        u07["reason"] = "no uncovered advisory mode or validation suppression detected"
    u07["evidence"] = {
        "validation_suppressions": blockers,
        "ambiguous_suppressions": reviews,
        "enforcement_coverage": enforcement,
    }

    u08 = _gate_by_id(gates, "U08")
    references = semantic_analysis["action_references"]
    if references:
        u08["status"] = "warning"
        u08["reason"] = "one or more external GitHub Actions are not pinned to immutable SHAs"
    else:
        u08["status"] = "clear"
        u08["reason"] = "all observed external GitHub Action references are immutable"
    u08["evidence"] = {"mutable_action_references": references}


def run(
    repo: Path,
    mode: str = "filesystem",
    capabilities: set[str] | None = None,
) -> dict[str, Any]:
    context = establish(mode, capabilities)
    evidence = collect(repo)
    if mode == "connector":
        evidence["complete_tree"] = False
        evidence["source"] = "connector"

    workflows = load_workflows(repo)
    for workflow in workflows:
        evidence.setdefault("texts", {})[workflow["path"]] = workflow["text"]

    profile = infer(evidence)
    capability_model = detect_capabilities(evidence, profile)
    contradictions = detect_contradictions(evidence, capability_model)
    gates = evaluate_universal_gates(repo, evidence, context)
    gates += evaluate_archetype_gates(repo, profile, capability_model, context)

    semantic_analysis = {
        "suppressions": analyze_suppressions(workflows),
        "enforcement_coverage": analyze_enforcement(workflows),
        "action_references": analyze_actions(workflows),
    }
    _wire_semantics_into_universal_gates(gates, semantic_analysis)

    findings: list[dict[str, Any]] = []
    for item in semantic_analysis["suppressions"]:
        remediation = (
            "remove_validation_suppression"
            if item["kind"] == "validation"
            else "document cleanup suppression or review ambiguous suppression"
        )
        findings.append(
            _finding(
                finding_id=f"SEM-SUP-{len(findings) + 1}",
                claim=f"shell suppression classified as {item['kind']}",
                severity="high" if item["status"] == "blocker" else "low",
                status=item["status"],
                confidence=item["confidence"],
                evidence={
                    "file": item["file"],
                    "line": item["line"],
                    "command": item["command"],
                    "normalized_command": item.get("normalized_command"),
                },
                inference_type="contextual_semantic",
                false_positive_risk="medium" if item["kind"] == "ambiguous" else "low",
                remediation=remediation,
                gate_id=14, gate_name="ci-integrity", domain="ci",
            )
        )

    enforcement = semantic_analysis["enforcement_coverage"]
    if enforcement["advisory"]:
        findings.append(
            _finding(
                finding_id="SEM-CI-ADVISORY",
                claim="advisory CI mode evaluated against compensating enforcement",
                severity="medium",
                status=enforcement["status"],
                confidence=enforcement["confidence"],
                evidence=enforcement,
                inference_type="coverage_analysis",
                false_positive_risk="medium",
                remediation="add enforcing equivalents for uncovered advisory checks",
                gate_id=14, gate_name="ci-integrity", domain="ci",
            )
        )

    for item in semantic_analysis["action_references"]:
        findings.append(
            _finding(
                finding_id=f"SEM-ACT-{len(findings) + 1}",
                claim="mutable GitHub Action reference detected",
                severity="medium",
                status=item["status"],
                confidence=0.99,
                evidence=item,
                inference_type="deterministic_reference_analysis",
                false_positive_risk="low",
                remediation=item["remediation_id"],
                gate_id=14, gate_name="ci-integrity", domain="ci",
            )
        )

    for item in contradictions:
        findings.append(
            _finding(
                finding_id=item["id"],
                claim="declared model conflicts with observed repository behavior",
                severity="high",
                status=item["contradiction_status"],
                confidence=item["confidence"],
                evidence={
                    "declared_model": item["declared_model"],
                    "observed_behavior": item["observed_behavior"],
                    "provenance": item["provenance"],
                },
                inference_type="cross_source_contradiction",
                false_positive_risk="medium",
                remediation="resolve ownership or align documentation and workflow behavior",
                gate_id=12, gate_name="cross-component-contracts", domain="architecture",
            )
        )

    full_preflight = context.mode == "filesystem" and context.supports(
        {"recursive_tree", "command_execution", "executable_worktree"}
    )
    return {
        "version": "3.5",
        "versions": dict(VERSIONS),
        "execution_context": context.as_dict(),
        "repository_profile": profile,
        "capability_model": capability_model,
        "contradictions": contradictions,
        "gates": gates,
        "semantic_analysis": semantic_analysis,
        "findings": findings,
        "full_preflight": full_preflight,
    }
