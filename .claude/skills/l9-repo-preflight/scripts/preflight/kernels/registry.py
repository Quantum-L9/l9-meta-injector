from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import yaml


@dataclass(frozen=True)
class KernelContract:
    kernel_id: str
    version: str
    ring: str
    category: str
    description: str
    requires: tuple[str, ...]
    hard_bans: tuple[str, ...]
    fail_closed: bool
    source: str


class KernelRegistry:
    def __init__(self, contracts: dict[str, KernelContract], bindings: dict[str, str]):
        self.contracts = contracts
        self.bindings = bindings

    def require(self, kernel_id: str) -> KernelContract:
        try:
            return self.contracts[kernel_id]
        except KeyError as exc:
            raise ValueError(f'required kernel unavailable: {kernel_id}') from exc

    def as_dict(self) -> dict[str, Any]:
        return {
            'contracts': {
                key: {
                    'kernel_id': value.kernel_id,
                    'version': value.version,
                    'ring': value.ring,
                    'category': value.category,
                    'description': value.description,
                    'requires': list(value.requires),
                    'hard_bans': list(value.hard_bans),
                    'fail_closed': value.fail_closed,
                    'source': value.source,
                    'binding': self.bindings.get(key),
                }
                for key, value in sorted(self.contracts.items())
            }
        }


def load_registry(skill_root: Path) -> KernelRegistry:
    kernel_dir = skill_root / 'config' / 'kernels'
    contracts: dict[str, KernelContract] = {}
    for path in sorted(kernel_dir.glob('*.yaml')):
        payload = yaml.safe_load(path.read_text(encoding='utf-8'))
        if not isinstance(payload, dict):
            raise ValueError(f'invalid kernel document: {path}')
        kernel_id = payload.get('kernel_id')
        if not isinstance(kernel_id, str) or not kernel_id:
            raise ValueError(f'kernel_id missing: {path}')
        if kernel_id in contracts:
            raise ValueError(f'duplicate kernel_id: {kernel_id}')
        contracts[kernel_id] = KernelContract(
            kernel_id=kernel_id,
            version=str(payload.get('version', 'UNKNOWN')),
            ring=str(payload.get('ring', 'UNKNOWN')),
            category=str(payload.get('category', 'UNKNOWN')),
            description=str(payload.get('description', '')),
            requires=tuple(str(item) for item in payload.get('requires', []) or []),
            hard_bans=tuple(str(item) for item in payload.get('hard_bans', []) or []),
            fail_closed=bool(payload.get('fail_closed', True)),
            source=str(path.relative_to(skill_root)),
        )
    bindings = {
        'mode_router_kernel.v1': 'scripts.preflight.kernels.mode_router',
        'validation_and_errors_kernel.v1': 'scripts.preflight.kernels.validation',
        'convergence_kernel.v1': 'scripts.preflight.kernels.convergence',
        'dependency_audit_kernel.v1': 'Gate 15 dependency audit',
        'ci_gate_kernel.v1': 'Gate 14 CI truthfulness and integrity',
    }
    return KernelRegistry(contracts, bindings)
