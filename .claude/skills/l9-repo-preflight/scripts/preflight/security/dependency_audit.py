from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from ..gates.model import EvidenceState, Finding

GATE_ID = 15
GATE_NAME = 'security-supply-chain'


def _finding(fid: str, claim: str, severity: str, status: str, evidence: dict[str, Any], remediation: str, confidence: float = 1.0) -> dict[str, Any]:
    return Finding(
        id=fid, gate_id=GATE_ID, gate_name=GATE_NAME, domain='dependency', claim=claim,
        severity=severity, status=status, confidence=confidence, evidence=evidence,
        evidence_state=EvidenceState.NOT_OBSERVED if status == 'not_observed' else EvidenceState.OBSERVED,
        inference_type='deterministic_dependency_contract', false_positive_risk='low',
        remediation_id_or_recommended_change=remediation, autofixable=False,
        provenance=[{'source': 'dependency_audit_kernel.v1'}],
    ).as_dict()


def _python_requirements(path: Path) -> list[str]:
    dependencies: list[str] = []
    for line in path.read_text(encoding='utf-8', errors='ignore').splitlines():
        line = line.strip()
        if not line or line.startswith(('#', '-r ', '--')):
            continue
        dependencies.append(line)
    return dependencies


def _package_json(path: Path) -> tuple[list[str], bool]:
    payload = json.loads(path.read_text(encoding='utf-8'))
    dependencies: list[str] = []
    for section in ('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'):
        values = payload.get(section, {})
        if isinstance(values, dict):
            dependencies.extend(f'{name}@{version}' for name, version in sorted(values.items()))
    return dependencies, (path.parent / 'package-lock.json').exists() or (path.parent / 'pnpm-lock.yaml').exists() or (path.parent / 'yarn.lock').exists()


def audit(repo: Path, tools: dict[str, dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    inventory: dict[str, Any] = {'manifests': [], 'dependency_count': 0, 'lockfiles': [], 'compatibility_risks': []}
    findings: list[dict[str, Any]] = []
    dependencies: list[str] = []
    requirements = repo / 'requirements.txt'
    pyproject = repo / 'pyproject.toml'
    package_json = repo / 'package.json'
    if requirements.exists():
        inventory['manifests'].append('requirements.txt')
        dependencies.extend(_python_requirements(requirements))
        for candidate in ('requirements.lock', 'requirements-ci.lock', 'uv.lock', 'poetry.lock', 'Pipfile.lock'):
            if (repo / candidate).exists():
                inventory['lockfiles'].append(candidate)
    if pyproject.exists():
        inventory['manifests'].append('pyproject.toml')
        text = pyproject.read_text(encoding='utf-8', errors='ignore')
        dependencies.extend(re.findall(r'^[ \t]*["\']([^"\']+)["\'][,]?[ \t]*$', text, re.MULTILINE))
        for candidate in ('uv.lock', 'poetry.lock', 'Pipfile.lock'):
            if (repo / candidate).exists():
                inventory['lockfiles'].append(candidate)
    if package_json.exists():
        inventory['manifests'].append('package.json')
        js_dependencies, locked = _package_json(package_json)
        dependencies.extend(js_dependencies)
        if locked:
            inventory['lockfiles'].extend(name for name in ('package-lock.json', 'pnpm-lock.yaml', 'yarn.lock') if (repo / name).exists())
    inventory['dependency_count'] = len(dependencies)
    inventory['dependencies'] = dependencies
    if inventory['dependency_count'] > 0 and not inventory['lockfiles']:
        findings.append(_finding(
            'G15-DEP-LOCK', 'dependency manifests exist without an observed lockfile', 'medium', 'warning',
            {'manifests': inventory['manifests'], 'lockfiles': []},
            'add and maintain the ecosystem-appropriate deterministic lockfile', 0.95,
        ))
    floating = [dep for dep in dependencies if re.search(r'(@\*|@latest$|>=|\^|~|\*)', dep)]
    if floating:
        inventory['compatibility_risks'].append('floating_or_range_constraints')
        findings.append(_finding(
            'G15-DEP-RANGE', 'dependency constraints permit version drift', 'low', 'warning',
            {'examples': floating[:20], 'count': len(floating)},
            'review compatibility ranges and pin high-risk build/runtime dependencies', 0.85,
        ))
    scanners: list[str] = []
    if any(name in inventory['manifests'] for name in ('requirements.txt', 'pyproject.toml')):
        scanners.append('pip-audit')
    if 'package.json' in inventory['manifests']:
        scanners.append('npm')
    available = [name for name in scanners if tools.get(name, {}).get('availability') == 'available']
    inventory['scanner_candidates'] = scanners
    inventory['scanner_available'] = available
    if scanners and not available:
        findings.append(_finding(
            'G15-DEP-SCAN', 'dependency vulnerability evidence was not observed', 'medium', 'not_observed',
            {'scanner_candidates': scanners, 'available': []},
            'provide a supported vulnerability scanner or equivalent signed evidence',
        ))
    return inventory, findings
