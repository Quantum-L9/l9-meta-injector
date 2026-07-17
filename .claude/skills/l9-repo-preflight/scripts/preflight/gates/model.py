from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class EvidenceState(str, Enum):
    OBSERVED = "observed"
    MISSING = "missing"
    CONTRADICTED = "contradicted"
    NOT_OBSERVED = "not_observed"
    UNKNOWN = "unknown"


GATE_STATES = {
    "clear",
    "warning",
    "blocker",
    "not_applicable",
    "unknown",
    "not_observed",
    "contradicted",
    "requires_human_review",
}


@dataclass(frozen=True)
class GateSpec:
    gate_id: int
    name: str
    domain: str
    mandatory: bool = False
    required_capabilities: tuple[str, ...] = ()
    optional_capabilities: tuple[str, ...] = ()
    evidence_requirements: tuple[str, ...] = ()
    execution_requirements: tuple[str, ...] = ()
    absence_behavior: str = "not_observed"
    degraded_mode: str = "evidence_limited"
    modes: tuple[str, ...] = ("filesystem", "connector")


@dataclass
class Finding:
    id: str
    gate_id: int
    gate_name: str
    domain: str
    claim: str
    severity: str
    status: str
    confidence: float
    evidence: dict[str, Any]
    evidence_state: EvidenceState
    inference_type: str
    false_positive_risk: str
    remediation_id_or_recommended_change: str
    autofixable: bool = False
    provenance: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        if self.status not in GATE_STATES:
            raise ValueError(f"invalid finding status: {self.status}")
        if not 0 <= self.confidence <= 1:
            raise ValueError("finding confidence must be between 0 and 1")
        result = asdict(self)
        result["evidence_state"] = self.evidence_state.value
        return result


@dataclass
class GateResult:
    gate_id: int
    name: str
    status: str
    applicable: bool
    findings: list[dict[str, Any]]
    evidence_requirements: list[str]
    execution_requirements: list[str]
    reason: str = ""
    evidence: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        if self.status not in GATE_STATES:
            raise ValueError(f"invalid gate status: {self.status}")
        return asdict(self)


def gate(
    gid: str,
    name: str,
    status: str,
    evidence_requirements: list[str],
    evidence: dict[str, Any] | None = None,
    reason: str = "",
) -> dict[str, Any]:
    if status not in GATE_STATES:
        raise ValueError(status)
    return {
        "id": gid,
        "name": name,
        "status": status,
        "evidence_requirements": evidence_requirements,
        "evidence": evidence or {},
        "reason": reason,
    }
