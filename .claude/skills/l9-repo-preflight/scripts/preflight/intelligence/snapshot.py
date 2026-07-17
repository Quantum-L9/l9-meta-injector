from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .contracts import RepositorySnapshot

SCHEMA_VERSION = '1.1'
EXTRACTOR_BUNDLE_VERSION = '4.1'


def _digest_files(repo: Path, paths: list[str]) -> str:
    digest = hashlib.sha256()
    for relative in sorted(paths):
        path = repo / relative
        digest.update(relative.encode())
        digest.update(b'\0')
        try:
            digest.update(path.read_bytes())
        except OSError:
            digest.update(b'<unreadable>')
        digest.update(b'\0')
    return digest.hexdigest()


def _git_revision(repo: Path) -> str:
    try:
        result = subprocess.run(['git', '-C', str(repo), 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=5, check=False)
        return result.stdout.strip() if result.returncode == 0 else 'WORKTREE'
    except (OSError, subprocess.SubprocessError):
        return 'WORKTREE'


def create_snapshot(repo: Path, eligible_paths: list[str], parent_snapshot_id: str | None = None) -> RepositorySnapshot:
    source_digest = _digest_files(repo, eligible_paths)
    source_revision = _git_revision(repo)
    identity_payload = {
        'source_revision': source_revision,
        'source_digest': source_digest,
        'schema': SCHEMA_VERSION,
        'extractor': EXTRACTOR_BUNDLE_VERSION,
    }
    snapshot_id = 'rss_' + hashlib.sha256(json.dumps(identity_payload, sort_keys=True).encode()).hexdigest()[:32]
    return RepositorySnapshot(
        repository_snapshot_id=snapshot_id,
        parent_snapshot_id=parent_snapshot_id,
        source_revision=source_revision,
        source_digest='sha256:' + source_digest,
        index_schema_version=SCHEMA_VERSION,
        extractor_bundle_version=EXTRACTOR_BUNDLE_VERSION,
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def stable_fact_id(snapshot_id: str, fact: dict[str, Any]) -> str:
    source_range = fact.get('range', {})
    payload = {
        'snapshot': snapshot_id,
        'path': fact.get('path'),
        'language': fact.get('language'),
        'kind': fact.get('kind'),
        'qualified_name': fact.get('qualified_name') or fact.get('name'),
        'native_node_type': fact.get('native_node_type'),
        'structural_fingerprint': {
            'receiver': fact.get('receiver'),
            'arguments': fact.get('arguments', []),
            'start_byte': source_range.get('start_byte'),
            'end_byte': source_range.get('end_byte'),
        },
    }
    return 'sf_' + hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:32]
