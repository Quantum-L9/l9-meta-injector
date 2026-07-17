from __future__ import annotations

from pathlib import Path
from typing import Any

from .intelligence import SemanticQueryEngine, build_delta, build_module_graph
from .v4 import run as run_v4

VERSIONS = {
    'skill': '4.1', 'evaluator': '4.1', 'schema': '4.1', 'provider': '3.8',
    'repository_intelligence': '1.0', 'semantic_snapshot': '1.1',
    'resolution_graph': '1.0', 'semantic_query': '1.0', 'kernel_runtime': '1.0',
}


def _activate_from_semantics(report: dict[str, Any], snapshot: dict[str, Any]) -> None:
    summary = snapshot.get('summary', {})
    capabilities = report.setdefault('repository_profile', {}).setdefault('semantic_capabilities', [])
    rules = [
        ('api_contract_analysis', summary.get('route', 0) >= 1, {'route_count': summary.get('route', 0)}),
        ('cross_file_wiring_analysis', summary.get('import', 0) >= 1, {'import_count': summary.get('import', 0)}),
        ('call_structure_analysis', summary.get('call', 0) >= 1, {'call_count': summary.get('call', 0)}),
        ('error_boundary_analysis', summary.get('error_handler', 0) >= 1, {'error_handler_count': summary.get('error_handler', 0)}),
    ]
    for name, active, evidence in rules:
        capabilities.append({'name': name, 'status': 'active' if active else 'not_applicable', 'evidence': evidence, 'authority': 'semantic_snapshot'})


def run(
    repo: Path, mode: str = 'filesystem', capabilities: set[str] | None = None,
    audit_mode: str = 'auto', reasoning_provider: Any = None, github_provider: Any = None,
    repository: str | None = None, pr_number: int | None = None,
    advertised_capabilities: dict[str, Any] | None = None,
    reasoning_response: dict[str, Any] | None = None,
    remediation_allowed: bool = False, packaging_requested: bool = False,
    parent_semantic_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    report = run_v4(
        repo, mode=mode, capabilities=capabilities, audit_mode=audit_mode,
        reasoning_provider=reasoning_provider, github_provider=github_provider,
        repository=repository, pr_number=pr_number,
        advertised_capabilities=advertised_capabilities,
        reasoning_response=reasoning_response,
        remediation_allowed=remediation_allowed, packaging_requested=packaging_requested,
    )
    snapshot = report.pop('_semantic_snapshot_runtime', None)
    if not snapshot:
        from .syntax import build_index
        snapshot = build_index(repo)
    graph = build_module_graph(repo, snapshot)
    delta = build_delta(snapshot, parent_semantic_snapshot)
    query_engine = SemanticQueryEngine(snapshot, graph)
    report['version'] = '4.1'
    report['versions'] = {**report.get('versions', {}), **VERSIONS}
    report['repository_intelligence'] = {
        'ownership': 'deterministic_derived_evidence_projection',
        'source_authority': 'repository_source_bytes',
        'snapshot': snapshot['repository_snapshot'],
        'coverage': snapshot['coverage_ledger'],
        'fact_summary': snapshot['summary'],
        'module_graph_summary': graph['summary'],
        'artifacts': {
            'semantic_snapshot': 'semantic-snapshot.json',
            'semantic_coverage': 'semantic-coverage.json',
            'semantic_graph': 'semantic-resolution-graph.json',
            'semantic_delta': 'semantic-delta.json',
            'semantic_evidence': 'semantic-evidence.jsonl',
        },
        'query_capabilities': ['find_symbols', 'find_routes', 'find_importers', 'get_fact'],
        'sample_queries': {
            'routes': query_engine.find_routes(),
        },
    }
    report['semantic_snapshot'] = snapshot
    report['semantic_resolution_graph'] = graph
    report['semantic_delta'] = delta
    _activate_from_semantics(report, snapshot)
    coverage = snapshot['coverage_ledger']
    if not coverage.get('complete'):
        report['full_preflight'] = False
        report.setdefault('limitations', []).append('repository_intelligence_coverage_incomplete')
        report['preflight_result']['limitations'] = sorted(set(report['preflight_result'].get('limitations', []) + ['repository_intelligence_coverage_incomplete']))
    report['preflight_result']['repository_snapshot_id'] = snapshot['repository_snapshot']['repository_snapshot_id']
    report['preflight_result']['semantic_coverage_complete'] = coverage.get('complete', False)
    return report
