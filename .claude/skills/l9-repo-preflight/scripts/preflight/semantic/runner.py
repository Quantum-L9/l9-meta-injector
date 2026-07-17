"""Orchestrate semantic Gates 9-14 and normalize their output."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from . import gate09_wiring, gate10_dormant, gate11_drift, gate12_cross_component
from . import gate13_aggregation, gate14_ci_integrity


def evaluate_semantic_gates(
    repo: Path, evidence: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Run every semantic gate fail-open and return ordered findings and plans."""
    evidence = evidence or {}
    ctx = {"repo": repo}
    findings: list[dict[str, Any]] = []
    by_gate: dict[int, list[dict[str, Any]]] = {}

    for module in (
        gate09_wiring,
        gate10_dormant,
        gate11_drift,
        gate12_cross_component,
        gate14_ci_integrity,
    ):
        gate_findings = module.evaluate(evidence, ctx)
        by_gate[module.GATE_ID] = gate_findings
        findings.extend(gate_findings)

    aggregation = gate13_aggregation.aggregate(findings, evidence)
    by_gate[gate13_aggregation.GATE_ID] = aggregation

    ordered_findings = [
        finding
        for gate_id in sorted(by_gate)
        for finding in by_gate[gate_id]
    ]
    blockers = [
        finding for finding in findings
        if finding.get("authority_action") == "blocker"
    ]
    supported_actions = {"npm_ci", "uv_lock"}
    autofix_plans = [
        finding["autofix_plan"]
        for finding in findings
        if isinstance(finding.get("autofix_plan"), dict)
        and finding["autofix_plan"].get("action") in supported_actions
    ]
    return {
        "gates": [
            {
                "id": gate_id,
                "name": next(
                    (
                        f.get("gate_name")
                        for f in by_gate[gate_id]
                        if f.get("gate_name")
                    ),
                    f"semantic-gate-{gate_id}",
                ),
                "verdict": "blocker" if any(
                    f.get("authority_action") == "blocker"
                    for f in by_gate[gate_id]
                ) else "clear",
                "finding_count": len(by_gate[gate_id]),
                "findings": by_gate[gate_id],
            }
            for gate_id in sorted(by_gate)
        ],
        "findings": ordered_findings,
        "blockers": blockers,
        "autofix_plans": autofix_plans,
    }
