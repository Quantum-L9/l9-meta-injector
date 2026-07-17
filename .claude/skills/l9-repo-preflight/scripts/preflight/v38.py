from __future__ import annotations

from pathlib import Path
from typing import Any

from .environment import detect_environment
from .forensic.gate20 import evaluate as evaluate_gate20
from .gate_capabilities import contracts
from .gate_registry import run as run_extended
from .policy.loader import load as load_policy
from .probe.evidence_collector import collect
from .syntax.python_ast import scan_repo
from .tools.registry import discover as discover_tools
from .v35 import run as run_v35

VERSIONS = {
    "skill": "3.8",
    "evaluator": "3.8",
    "schema": "3.8",
    "provider": "3.8",
    "ast": "python.ast",
    "environment": "1.1",
    "gate20": "2.1",
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
) -> dict[str, Any]:
    report = run_v35(repo, mode, capabilities)
    report["version"] = "3.8"
    report["versions"] = dict(VERSIONS)

    evidence = collect(repo)
    evidence["source"] = "connector" if mode == "connector" else "filesystem"
    if mode == "connector":
        evidence["complete_tree"] = False

    tool_capabilities = discover_tools()
    environment = detect_environment(repo, mode, advertised_capabilities, tool_capabilities)
    ast_facts = scan_repo(repo)
    policy = load_policy(repo)
    extended = run_extended(repo, evidence, tool_capabilities, ast_facts, policy, environment)
    gate20 = evaluate_gate20(
        repo,
        report["repository_profile"],
        extended,
        evidence,
        audit_mode,
        reasoning_provider,
        github_provider,
        repository,
        pr_number,
        environment,
        reasoning_response,
    )
    gate20_status = "warning" if gate20["findings"] or gate20["limitations"] else "clear"
    extended.append(
        {
            "gate_id": 20,
            "name": "forensic-synthesis",
            "status": gate20_status,
            "applicable": True,
            "findings": gate20["findings"],
            "evidence_requirements": ["gate_results", "environment_capability_report"],
            "execution_requirements": [],
            "reason": "20A always runs; 20B and 20C resolve from environment capabilities",
            "evidence": gate20,
        }
    )

    report["environment_capability_report"] = environment
    report["environment_capability_report_ref"] = "environment-capability-report.json"
    report["gate_capability_contracts"] = contracts()
    report["extended_gate_results"] = extended
    report["tool_capabilities"] = tool_capabilities
    report["ast_evidence"] = {
        "engine": ast_facts["engine"],
        "files_scanned": len(ast_facts["files"]),
        "parse_error_count": len(ast_facts["parse_errors"]),
    }
    report["audit_policy"] = policy
    report["forensic_audit"] = gate20
    report["findings"].extend(
        finding for gate in extended for finding in gate.get("findings", [])
    )

    incomplete = [
        gate
        for gate in extended
        if gate["status"] in ("not_observed", "requires_human_review", "unknown")
    ]
    full_preflight = report["full_preflight"] and not incomplete and not gate20["limitations"]
    report["evidence_completeness"] = {
        "status": "warning" if incomplete else "clear",
        "incomplete_gates": [gate["gate_id"] for gate in incomplete],
        "full_preflight": full_preflight,
    }
    report["full_preflight"] = full_preflight

    if any(finding.get("status") == "blocker" for finding in report["findings"]):
        deterministic_status = "blocker"
    elif report["findings"] or incomplete:
        deterministic_status = "warning"
    else:
        deterministic_status = "clear"
    result_status = deterministic_status
    if deterministic_status == "clear" and gate20["limitations"]:
        result_status = "clear_with_limitations"
    report["preflight_result"] = {
        "status": result_status,
        "execution_depth": mode,
        "audit_depth": gate20["audit_depth"],
        "environment_capability_report_ref": "environment-capability-report.json",
        "limitations": environment["capability_limitations"] + gate20["limitations"],
        "deterministic_status": deterministic_status,
        "reasoning_assessment": "completed" if gate20["reasoning"]["executed"] else "not_observed",
        "final_status": deterministic_status,
        "confidence": gate20["confidence"],
    }
    return report
