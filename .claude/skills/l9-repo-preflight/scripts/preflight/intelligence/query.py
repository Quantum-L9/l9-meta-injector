from __future__ import annotations

from typing import Any


class SemanticQueryEngine:
    def __init__(self, snapshot: dict[str, Any], graph: dict[str, Any] | None = None):
        self.snapshot = snapshot
        self.graph = graph or {'edges': []}
        self._facts = {fact['fact_id']: fact for fact in snapshot.get('facts', [])}

    def _result(self, facts: list[dict[str, Any]], query: dict[str, Any]) -> dict[str, Any]:
        coverage = self.snapshot['coverage_ledger']
        return {
            'query': query,
            'repository_snapshot_id': self.snapshot['repository_snapshot']['repository_snapshot_id'],
            'facts': facts,
            'coverage': coverage,
            'limitations': list(coverage.get('known_blind_spots', [])),
            'authority_floor': 'structural_parse',
            'complete_for_requested_scope': bool(coverage.get('complete')),
        }

    def find_symbols(self, name: str | None = None, kind: str | None = None, scope: str | None = None) -> dict[str, Any]:
        facts = [fact for fact in self._facts.values() if fact.get('kind') == 'symbol']
        if name is not None:
            facts = [fact for fact in facts if fact.get('name') == name or fact.get('qualified_name') == name]
        if kind is not None:
            facts = [fact for fact in facts if fact.get('metadata', {}).get('symbol_kind') == kind]
        if scope is not None:
            facts = [fact for fact in facts if fact.get('path', '').startswith(scope)]
        return self._result(facts, {'operation': 'find_symbols', 'name': name, 'kind': kind, 'scope': scope})

    def find_routes(self, method: str | None = None, path: str | None = None) -> dict[str, Any]:
        facts = [fact for fact in self._facts.values() if fact.get('kind') == 'route']
        if method is not None:
            facts = [fact for fact in facts if fact.get('name', '').lower() == method.lower()]
        if path is not None:
            facts = [fact for fact in facts if path in ' '.join(fact.get('arguments', []))]
        return self._result(facts, {'operation': 'find_routes', 'method': method, 'path': path})

    def find_importers(self, module_path: str) -> dict[str, Any]:
        source_ids = {edge['source_fact_id'] for edge in self.graph.get('edges', []) if edge.get('target_id') == module_path}
        facts = [self._facts[fact_id] for fact_id in source_ids if fact_id in self._facts]
        return self._result(facts, {'operation': 'find_importers', 'module_path': module_path})

    def get_fact(self, fact_id: str) -> dict[str, Any]:
        facts = [self._facts[fact_id]] if fact_id in self._facts else []
        return self._result(facts, {'operation': 'get_fact', 'fact_id': fact_id})
