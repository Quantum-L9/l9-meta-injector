from __future__ import annotations

import json
from pathlib import Path

from preflight.kernels import converge_report, load_registry, route_mode, validate_kernel_bindings
from preflight.security.dependency_audit import audit
from preflight.v4 import run

ROOT = Path(__file__).resolve().parents[1]


def test_kernel_registry_has_all_governed_bindings() -> None:
    registry = load_registry(ROOT)
    assert set(registry.contracts) == {
        'dependency_audit_kernel.v1', 'mode_router_kernel.v1',
        'validation_and_errors_kernel.v1', 'convergence_kernel.v1',
    }
    assert validate_kernel_bindings(registry) == []
    assert registry.bindings['ci_gate_kernel.v1'] == 'Gate 14 CI truthfulness and integrity'


def test_mode_router_resolves_autonomous_auto_to_static() -> None:
    routed = route_mode(requested_mode='filesystem', audit_mode='auto', advertised={'autonomous_workflow': True})
    assert routed.audit_mode == 'static_only'
    assert routed.autonomous is True


def test_mode_router_prefers_host_agent() -> None:
    routed = route_mode(requested_mode='connector', audit_mode='auto', advertised={'host_agent': {'available': True}, 'mcp_bridge': {'available': True}})
    assert routed.audit_mode == 'host_agent'
    assert routed.interactive is True


def test_convergence_reaches_fixed_point() -> None:
    report, result = converge_report({'b': 2, 'a': 1}, lambda value: dict(sorted(value.items())))
    assert report == {'a': 1, 'b': 2}
    assert result['status'] == 'converged'
    assert result['passes_run'] == 2


def test_dependency_audit_warns_on_unlocked_manifest(tmp_path: Path) -> None:
    (tmp_path / 'package.json').write_text(json.dumps({'dependencies': {'x': '^1.0.0'}}), encoding='utf-8')
    inventory, findings = audit(tmp_path, {'npm': {'availability': 'available'}})
    assert inventory['dependency_count'] == 1
    ids = {finding['id'] for finding in findings}
    assert 'G15-DEP-LOCK' in ids
    assert 'G15-DEP-RANGE' in ids


def test_v4_report_exposes_kernel_runtime_and_convergence(tmp_path: Path) -> None:
    report = run(tmp_path, audit_mode='static_only')
    assert report['version'] == '4.0'
    assert report['versions']['kernel_runtime'] == '1.0'
    assert report['kernel_runtime']['activation_order'][0] == 'mode_router_kernel.v1'
    assert report['convergence']['status'] == 'converged'
    assert report['execution_mode']['audit_mode'] == 'static_only'


def test_v39_import_regression_is_fixed(tmp_path: Path) -> None:
    from preflight.v39 import run as run_v39
    report = run_v39(tmp_path, audit_mode='static_only')
    assert report['version'] == '3.9'
