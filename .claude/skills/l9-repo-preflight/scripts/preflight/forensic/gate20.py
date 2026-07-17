from __future__ import annotations

from pathlib import Path
from typing import Any

from ..gates.model import EvidenceState, Finding
from ..providers.github_mcp import GitHubEvidenceRequest, GitHubMcpEvidenceProvider
from ..providers.reasoning import ActionRequestProvider, AuditRequest, canonical_digest, completed_receipt, validate_response

GATE_ID = 20
GATE_NAME = "forensic-synthesis"


def _static(profile: dict[str, Any], gate_results: list[dict[str, Any]], evidence: dict[str, Any]) -> dict[str, Any]:
    prior = [finding for gate in gate_results for finding in gate.get("findings", [])]
    material = [
        {"finding_id": finding["id"], "gate_id": finding["gate_id"], "status": finding["status"]}
        for finding in prior
        if finding.get("status") in ("blocker", "contradicted", "requires_human_review")
    ]
    findings: list[dict[str, Any]] = []
    if material:
        findings.append(
            Finding(
                "G20-SYNTHESIS",
                20,
                GATE_NAME,
                "forensic",
                "cross-gate synthesis found material unresolved evidence",
                "medium",
                "warning",
                0.98,
                {"corroborated_findings": material},
                EvidenceState.OBSERVED,
                "cross_gate_synthesis",
                "low",
                "resolve the originating gate findings",
                False,
                [{"source": "gate_results"}],
            ).as_dict()
        )
    return {
        "stage": "20A",
        "executed": True,
        "status": "warning" if findings else "clear",
        "cross_gate_patterns": material,
        "contradiction_summary": evidence.get("contradictions", []),
        "systemic_risks": material,
        "evidence_confidence": 1.0 if evidence.get("complete_tree", True) else 0.75,
        "deterministic_recommendations": [
            finding.get("remediation_id_or_recommended_change")
            for finding in prior
            if finding.get("remediation_id_or_recommended_change")
        ],
        "unresolved_evidence_gaps": [
            finding["id"]
            for finding in prior
            if finding.get("status") in ("not_observed", "unknown")
        ],
        "findings": findings,
    }


def _resolve(mode: str, environment: dict[str, Any], provider: Any) -> dict[str, Any]:
    reasoning = environment["execution_environment"]["reasoning_provider"]
    host_available = bool(reasoning.get("host_agent_session"))
    external_configured = bool(reasoning.get("external_provider_configured"))
    external_callable = provider is not None
    requested = mode

    if mode in ("static", "static_only", "disabled"):
        resolved = "static_only"
    elif mode == "host_agent":
        resolved = "host_agent" if host_available else "static_only"
    elif mode == "external_provider":
        resolved = "external_provider" if external_configured and external_callable else "static_only"
    elif mode == "full":
        if host_available:
            resolved = "host_agent"
        elif external_configured and external_callable:
            resolved = "external_provider"
        else:
            resolved = "static_only"
    else:
        if host_available:
            resolved = "host_agent"
        elif external_configured and external_callable:
            resolved = "external_provider"
        else:
            resolved = "static_only"

    fallback = resolved == "static_only" and requested not in ("static", "static_only", "disabled")
    return {
        "requested_mode": requested,
        "resolved_mode": resolved,
        "provider_type": resolved if resolved != "static_only" else "none",
        "provider_available": resolved != "static_only",
        "credentials_available": False
        if resolved == "host_agent"
        else reasoning.get("credentials_available", "unknown"),
        "invocation_attempted": False,
        "fallback_applied": fallback,
        "fallback_reason": "reasoning_provider_unavailable" if fallback else None,
        "capability_source": "environment_capability_report",
    }


def evaluate(
    repo: Path,
    profile: dict[str, Any],
    gate_results: list[dict[str, Any]],
    evidence: dict[str, Any],
    mode: str = "auto",
    reasoning_provider: Any = None,
    github_provider: Any = None,
    repository: str | None = None,
    pr_number: int | None = None,
    environment: dict[str, Any] | None = None,
    reasoning_response: dict[str, Any] | None = None,
    all_findings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    del repo
    environment = environment or {"execution_environment": {"reasoning_provider": {}}}
    surfaced_findings = list(all_findings or [finding for gate in gate_results for finding in gate.get("findings", [])])
    synthesis_results = list(gate_results)
    if all_findings is not None:
        synthesis_results.append({"gate_id": 0, "name": "all-surfaced-findings", "findings": surfaced_findings})
    static = _static(profile, synthesis_results, evidence)
    digest = canonical_digest({"profile": profile, "findings": surfaced_findings, "static": static})
    resolution = _resolve(mode, environment, reasoning_provider)
    reasoning = {
        "stage": "20B",
        "executed": False,
        "status": "not_observed",
        "reason": "reasoning_provider_unavailable",
        "request_artifact": None,
        "response_validation": None,
        "receipt": None,
    }

    if resolution["resolved_mode"] in ("host_agent", "external_provider"):
        provider = reasoning_provider if resolution["resolved_mode"] == "external_provider" else ActionRequestProvider()
        request = AuditRequest(
            "full",
            profile,
            synthesis_results,
            {
                "all_findings": surfaced_findings + static.get("findings", []),
                "deterministic_summary": static,
                "contradictions": evidence.get("contradictions", []),
                "evidence_gaps": static["unresolved_evidence_gaps"],
            },
            digest,
        )
        response = provider.analyze(request)
        resolution["invocation_attempted"] = True
        reasoning.update({"receipt": response.receipt, "request_artifact": response.payload})
        if reasoning_response is not None:
            known_ids = {finding["id"] for finding in surfaced_findings if finding.get("id")}
            known_ids.update(finding["id"] for finding in static.get("findings", []) if finding.get("id"))
            valid, errors = validate_response(reasoning_response, request, known_ids)
            reasoning.update(
                {
                    "executed": valid,
                    "status": "clear" if valid else "requires_human_review",
                    "reason": None if valid else "invalid_provider_response",
                    "response_validation": {"valid": valid, "errors": errors},
                    "response": reasoning_response if valid else None,
                }
            )
            if valid:
                reasoning["receipt"] = completed_receipt(reasoning.get("receipt"), reasoning_response)
        elif response.status == "not_observed":
            reasoning["reason"] = "host_action_required"

    pr_context = {
        "stage": "20C",
        "executed": False,
        "status": "not_observed",
        "reason": "pr_context_unavailable",
        "receipt": None,
    }
    if pr_number is not None or mode == "pr":
        github = github_provider or GitHubMcpEvidenceProvider()
        receipt = github.collect(GitHubEvidenceRequest(repository or "UNKNOWN", pr_number=pr_number))
        pr_context["receipt"] = receipt
        if receipt.get("status") not in ("not_observed", "unsupported_capability"):
            pr_context.update({"executed": True, "status": "clear", "reason": None})

    audit_depth = (
        "pr_contextual"
        if pr_context["executed"]
        else "reasoning_enriched"
        if reasoning["executed"]
        else "deterministic"
    )
    limitations: list[str] = []
    if not reasoning["executed"]:
        limitations.append("gate20_reasoning_not_executed")
    if (pr_number is not None or mode == "pr") and not pr_context["executed"]:
        limitations.append("gate20_pr_context_not_executed")

    evidence_confidence = static["evidence_confidence"]
    deterministic_confidence = 0.9
    reasoning_confidence = 0.8 if reasoning["executed"] else None
    denominator = 3 if reasoning["executed"] else 2
    overall = round(
        (evidence_confidence + deterministic_confidence + (reasoning_confidence or 0)) / denominator,
        2,
    )
    confidence = {
        "evidence_confidence": evidence_confidence,
        "deterministic_analysis_confidence": deterministic_confidence,
        "reasoning_confidence": reasoning_confidence,
        "overall_confidence": overall,
        "formula": "mean(observed confidence components)",
    }
    return {
        "mode": mode,
        "static": static,
        "reasoning": reasoning,
        "pr_context": pr_context,
        "provider_resolution": resolution,
        "audit_depth": audit_depth,
        "execution_depth": evidence.get("source", "filesystem"),
        "limitations": limitations,
        "confidence": confidence,
        "findings": static["findings"],
        "provider_receipts": [
            receipt for receipt in (reasoning.get("receipt"), pr_context.get("receipt")) if receipt
        ],
        "audit_limitations": limitations,
        "evidence_digest": digest,
    }
