from __future__ import annotations

from typing import Any


def build_delta(current: dict[str, Any], parent: dict[str, Any] | None) -> dict[str, Any]:
    current_id = current['repository_snapshot']['repository_snapshot_id']
    if parent is None:
        return {
            'delta_schema_version': '1.0',
            'repository_snapshot_id': current_id,
            'parent_snapshot_id': None,
            'status': 'not_observed',
            'reason': 'parent_semantic_snapshot_not_provided',
            'added_fact_ids': [], 'removed_fact_ids': [], 'changed_fact_ids': [],
        }
    current_facts = {fact['fact_id']: fact for fact in current.get('facts', [])}
    parent_facts = {fact['fact_id']: fact for fact in parent.get('facts', [])}
    return {
        'delta_schema_version': '1.0',
        'repository_snapshot_id': current_id,
        'parent_snapshot_id': parent['repository_snapshot']['repository_snapshot_id'],
        'status': 'observed',
        'added_fact_ids': sorted(current_facts.keys() - parent_facts.keys()),
        'removed_fact_ids': sorted(parent_facts.keys() - current_facts.keys()),
        'changed_fact_ids': [],
    }
