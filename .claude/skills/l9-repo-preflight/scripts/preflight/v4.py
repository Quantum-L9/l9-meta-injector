from __future__ import annotations

from pathlib import Path
from typing import Any

from .environment.detector import stable_fingerprint
from .kernels import converge_report, load_registry, route_mode, validate_kernel_bindings
from .v39 import run as run_v39

VERSIONS = {
    'skill': '4.0', 'evaluator': '4.0', 'schema': '4.0', 'provider': '3.8',
    'semantic_index': '1.0', 'tree_sitter': '0.26-compatible', 'environment': '1.3',
    'gate20': '2.1', 'kernel_runtime': '1.0',
}


def _normalize(report: dict[str, Any]) -> dict[str, Any]:
    report['findings'] = sorted(report.get('findings', []), key=lambda item: (str(item.get('id')), str(item.get('claim'))))
    report['extended_gate_results'] = sorted(report.get('extended_gate_results', []), key=lambda item: int(item.get('gate_id', 0)))
    report['limitations'] = sorted(set(report.get('limitations', []))) if isinstance(report.get('limitations'), list) else report.get('limitations', [])
    return report


def run(
    repo: Path, mode: str = 'filesystem', capabilities: set[str] | None = None,
    audit_mode: str = 'auto', reasoning_provider: Any = None, github_provider: Any = None,
    repository: str | None = None, pr_number: int | None = None,
    advertised_capabilities: dict[str, Any] | None = None,
    reasoning_response: dict[str, Any] | None = None,
    remediation_allowed: bool = False, packaging_requested: bool = False,
) -> dict[str, Any]:
    skill_root = Path(__file__).resolve().parents[2]
    registry = load_registry(skill_root)
    binding_issues = validate_kernel_bindings(registry)
    blockers = [issue for issue in binding_issues if issue.status == 'blocker']
    if blockers:
        raise RuntimeError('; '.join(issue.message for issue in blockers))
    routed = route_mode(
        requested_mode=mode, audit_mode=audit_mode, advertised=advertised_capabilities,
        remediation_allowed=remediation_allowed, packaging_requested=packaging_requested,
    )
    report = run_v39(
        repo, mode=routed.resolved_mode, capabilities=capabilities, audit_mode=routed.audit_mode,
        reasoning_provider=reasoning_provider, github_provider=github_provider,
        repository=repository, pr_number=pr_number,
        advertised_capabilities=advertised_capabilities, reasoning_response=reasoning_response,
    )
    report['version'] = '4.0'
    report['versions'] = dict(VERSIONS)
    report['execution_mode'] = routed.as_dict()
    report['kernel_runtime'] = {
        **registry.as_dict(),
        'validation_issues': [issue.as_dict() for issue in binding_issues],
        'activation_order': [
            'mode_router_kernel.v1', 'validation_and_errors_kernel.v1',
            'dependency_audit_kernel.v1', 'convergence_kernel.v1',
        ],
    }
    report['environment_capability_report']['environment_fingerprint'] = stable_fingerprint(report['environment_capability_report'])
    converged_report, convergence = converge_report(report, _normalize, threshold=0.95, max_passes=5)
    converged_report['convergence'] = convergence
    if convergence['status'] != 'converged':
        converged_report.setdefault('findings', []).append({
            'id': 'KERNEL-CONVERGENCE-BLOCKED', 'gate_id': 20, 'gate_name': 'forensic-synthesis',
            'domain': 'governance', 'claim': 'report failed to reach a deterministic fixed point',
            'severity': 'high', 'status': 'requires_human_review', 'confidence': 1.0,
            'evidence': convergence, 'evidence_state': 'observed', 'inference_type': 'deterministic',
            'false_positive_risk': 'low',
            'remediation_id_or_recommended_change': 'repair nondeterministic report generation and rerun',
            'autofixable': False, 'provenance': [{'source': 'convergence_kernel.v1'}],
        })
        converged_report['full_preflight'] = False
    return converged_report
