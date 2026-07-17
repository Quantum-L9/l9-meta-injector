from __future__ import annotations

import json
from pathlib import Path

from preflight.intelligence import SemanticQueryEngine, build_delta, build_module_graph
from preflight.syntax import build_index
from preflight.v41 import run


def test_snapshot_has_stable_identity_authority_and_coverage(tmp_path: Path) -> None:
    (tmp_path / 'a.py').write_text('from b import work\n\ndef run():\n    return work()\n', encoding='utf-8')
    (tmp_path / 'b.py').write_text('def work():\n    return 1\n', encoding='utf-8')
    first = build_index(tmp_path)
    second = build_index(tmp_path)
    assert first['repository_snapshot']['repository_snapshot_id'] == second['repository_snapshot']['repository_snapshot_id']
    assert first['coverage_ledger']['eligible_files'] == 2
    assert first['facts']
    assert all(fact['fact_id'].startswith('sf_') for fact in first['facts'])
    assert all('syntax' in fact['authority'] and 'resolution' in fact['authority'] for fact in first['facts'])


def test_module_graph_resolves_local_python_import(tmp_path: Path) -> None:
    (tmp_path / 'a.py').write_text('from b import work\n', encoding='utf-8')
    (tmp_path / 'b.py').write_text('def work():\n    return 1\n', encoding='utf-8')
    snapshot = build_index(tmp_path)
    graph = build_module_graph(tmp_path, snapshot)
    assert any(edge['target_id'] == 'b.py' and edge['resolution_status'] == 'resolved' for edge in graph['edges'])


def test_query_results_include_coverage_and_snapshot(tmp_path: Path) -> None:
    (tmp_path / 'api.py').write_text('def handler():\n    return 1\n', encoding='utf-8')
    snapshot = build_index(tmp_path)
    engine = SemanticQueryEngine(snapshot)
    result = engine.find_symbols('handler')
    assert result['facts'][0]['name'] == 'handler'
    assert result['repository_snapshot_id'] == snapshot['repository_snapshot']['repository_snapshot_id']
    assert 'complete_for_requested_scope' in result


def test_delta_without_parent_is_honestly_not_observed(tmp_path: Path) -> None:
    (tmp_path / 'a.py').write_text('x = 1\n', encoding='utf-8')
    snapshot = build_index(tmp_path)
    delta = build_delta(snapshot, None)
    assert delta['status'] == 'not_observed'
    assert delta['reason'] == 'parent_semantic_snapshot_not_provided'


def test_v41_report_exposes_intelligence_plane(tmp_path: Path) -> None:
    (tmp_path / 'README.md').write_text('# Example\n', encoding='utf-8')
    (tmp_path / 'app.py').write_text('def run():\n    return 1\n', encoding='utf-8')
    report = run(tmp_path, audit_mode='static_only')
    assert report['version'] == '4.1'
    assert report['repository_intelligence']['ownership'] == 'deterministic_derived_evidence_projection'
    assert report['preflight_result']['repository_snapshot_id'].startswith('rss_')
    assert report['semantic_snapshot']['repository_snapshot']['repository_snapshot_id'] == report['preflight_result']['repository_snapshot_id']
