from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .contracts import ResolutionEdge


def _module_candidates(repo: Path, source_path: str, language: str, raw: str) -> list[str]:
    token = raw.strip()
    if language == 'python':
        match = re.search(r'^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))', token)
        module = next((group for group in match.groups() if group), '') if match else ''
        if not module:
            return []
        base = module.replace('.', '/')
        return [candidate for candidate in (base + '.py', base + '/__init__.py') if (repo / candidate).is_file()]
    match = re.search(r'(?:from\s+|require\s*\(\s*)[\'\"]([^\'\"]+)', token)
    module = match.group(1) if match else ''
    if not module or not module.startswith('.'):
        return []
    base = (repo / source_path).parent / module
    candidates = []
    for suffix in ('', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'):
        candidate = Path(str(base) + suffix).resolve()
        try:
            relative = str(candidate.relative_to(repo.resolve()))
        except ValueError:
            continue
        if candidate.is_file():
            candidates.append(relative)
    return sorted(set(candidates))


def build_module_graph(repo: Path, snapshot: dict[str, Any]) -> dict[str, Any]:
    edges: list[dict[str, Any]] = []
    for fact in snapshot.get('facts', []):
        if fact.get('kind') != 'import':
            continue
        candidates = _module_candidates(repo, fact['path'], fact['language'], fact.get('name', ''))
        status = 'resolved' if len(candidates) == 1 else ('candidate' if candidates else 'unresolved')
        targets = candidates or [None]
        for target in targets:
            payload = [fact['fact_id'], target, 'imports']
            edge_id = 're_' + hashlib.sha256(json.dumps(payload).encode()).hexdigest()[:32]
            edge = ResolutionEdge(
                edge_id=edge_id,
                source_fact_id=fact['fact_id'],
                target_id=target,
                relation='imports',
                resolution_status=status,
                confidence=1.0 if status == 'resolved' else (0.6 if status == 'candidate' else 0.0),
                resolution_method='deterministic_local_module_resolution',
                candidate_count=len(candidates),
                limitations=() if candidates else ('external_dynamic_or_unresolved_module',),
            )
            edges.append(edge.as_dict())
    return {
        'graph_schema_version': '1.0',
        'repository_snapshot_id': snapshot['repository_snapshot']['repository_snapshot_id'],
        'layer': 'deterministic_module_graph',
        'edges': edges,
        'summary': {
            'total_edges': len(edges),
            'resolved': sum(1 for edge in edges if edge['resolution_status'] == 'resolved'),
            'candidate': sum(1 for edge in edges if edge['resolution_status'] == 'candidate'),
            'unresolved': sum(1 for edge in edges if edge['resolution_status'] == 'unresolved'),
        },
    }
