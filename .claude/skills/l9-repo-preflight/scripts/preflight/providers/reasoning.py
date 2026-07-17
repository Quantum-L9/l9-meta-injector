from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from typing import Any, Protocol


@dataclass(frozen=True)
class AuditRequest:
    mode: str
    repository_profile: dict[str, Any]
    gate_results: list[dict[str, Any]]
    evidence: dict[str, Any]
    evidence_digest: str = ""


@dataclass(frozen=True)
class AuditResponse:
    status: str
    findings: list[dict[str, Any]]
    provider: str
    receipt: dict[str, Any]
    payload: dict[str, Any] | None = None


class AuditReasoningProvider(Protocol):
    def analyze(self, request: AuditRequest) -> AuditResponse: ...


def canonical_digest(payload: dict[str, Any]) -> str:
    clean = json.loads(json.dumps(payload))
    clean.pop("generated_at", None)
    return hashlib.sha256(
        json.dumps(clean, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


class ActionRequestProvider:
    provider_type = "host_agent"

    def analyze(self, request: AuditRequest) -> AuditResponse:
        action = {
            "schema_version": "1.0",
            "task": "forensic_synthesis",
            "evidence_digest": request.evidence_digest,
            "deterministic_summary": request.evidence.get("deterministic_summary", {}),
            "finding_ids": sorted({
                finding.get("id")
                for finding in request.evidence.get("all_findings", [])
                if finding.get("id")
            } or {
                finding.get("id")
                for gate in request.gate_results
                for finding in gate.get("findings", [])
                if finding.get("id")
            }),
            "contradictions": request.evidence.get("contradictions", []),
            "evidence_gaps": request.evidence.get("evidence_gaps", []),
            "constraints": [
                "do_not_invent_evidence",
                "do_not_downgrade_mandatory_findings",
                "preserve_not_observed_states",
                "cite_known_finding_ids",
            ],
        }
        receipt = {
            "provider_type": "host_agent",
            "provider_identity": "host_runtime",
            "model_identity": "UNKNOWN",
            "prompt_contract_version": "1.0",
            "evidence_digest": request.evidence_digest,
            "response_digest": "UNKNOWN",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "reproducible": False,
            "cached": False,
            "redaction_applied": True,
            "validation_status": "not_executed",
            "action": "llm_audit_required",
            "credentials_required": False,
        }
        return AuditResponse("not_observed", [], "structured_host_request", receipt, action)


def completed_receipt(base: dict[str, Any] | None, response: dict[str, Any], model_identity: str = "active_host_agent") -> dict[str, Any]:
    receipt = dict(base or {})
    receipt.update({
        "provider_type": receipt.get("provider_type", "host_agent"),
        "provider_identity": receipt.get("provider_identity", "host_runtime"),
        "model_identity": model_identity,
        "response_digest": canonical_digest(response),
        "validation_status": "validated",
        "action": "llm_audit_completed",
        "reproducible": False,
        "cached": False,
        "credentials_required": False,
    })
    return receipt


_REQUIRED_RESPONSE_FIELDS = {
    "schema_version",
    "evidence_digest",
    "conclusions",
    "prioritized_actions",
    "challenged_findings",
    "unresolved_questions",
    "confidence",
    "references_to_known_finding_ids",
}


def validate_response(
    response: dict[str, Any], request: AuditRequest, known_ids: set[str]
) -> tuple[bool, list[str]]:
    errors: list[str] = []
    missing = sorted(_REQUIRED_RESPONSE_FIELDS - set(response))
    if missing:
        errors.append("missing_required_fields:" + ",".join(missing))
    if response.get("schema_version") != "1.0":
        errors.append("invalid_schema_version")
    if response.get("evidence_digest") != request.evidence_digest:
        errors.append("evidence_digest_mismatch")
    for field in ("conclusions", "prioritized_actions", "challenged_findings", "unresolved_questions", "references_to_known_finding_ids"):
        if field in response and not isinstance(response.get(field), list):
            errors.append(f"invalid_type:{field}")
    references = set(response.get("references_to_known_finding_ids", []))
    if not references.issubset(known_ids):
        errors.append("unknown_finding_id")
    for conclusion in response.get("conclusions", []):
        if not isinstance(conclusion, dict) or not isinstance(conclusion.get("summary"), str):
            errors.append("invalid_conclusion")
            continue
        if not set(conclusion.get("supported_by", [])).issubset(known_ids):
            errors.append("unknown_conclusion_finding_id")
    for action in response.get("prioritized_actions", []):
        if not isinstance(action, dict) or not isinstance(action.get("priority"), int) or action.get("priority", 0) < 1 or not isinstance(action.get("action"), str):
            errors.append("invalid_prioritized_action")
            continue
        if not set(action.get("addresses", [])).issubset(known_ids):
            errors.append("unknown_action_finding_id")
    confidence = response.get("confidence")
    if not isinstance(confidence, (int, float)) or not 0 <= float(confidence) <= 1:
        errors.append("invalid_confidence")
    for challenge in response.get("challenged_findings", []):
        finding_id = challenge.get("finding_id")
        if finding_id is not None and finding_id not in known_ids:
            errors.append("unknown_challenged_finding_id")
        if challenge.get("proposed_status") in {"clear", "not_applicable"}:
            errors.append("prohibited_deescalation")
    return not errors, sorted(set(errors))
