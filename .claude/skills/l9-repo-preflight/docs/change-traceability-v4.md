# v4 Kernel Integration Traceability

| Supplied contract | Runtime implementation | Verification |
|---|---|---|
| `mode_router_kernel.v1` | `scripts/preflight/kernels/mode_router.py`; invoked before v3.9 evaluation by `v4.py` | autonomous and host-agent routing tests |
| `validation_and_errors_kernel.v1` | `scripts/preflight/kernels/validation.py`; fail-closed binding checks and canonical error boundary | registry binding test and existing gate crash tests |
| `dependency_audit_kernel.v1` | `scripts/preflight/security/dependency_audit.py`; consumed by Gate 15 | manifest, lockfile, range and scanner tests |
| `ci_gate_kernel.v1` requirement | bound to existing Gate 14 CI truthfulness/integrity implementation | kernel registry binding assertion |
| `convergence_kernel.v1` | `scripts/preflight/kernels/convergence.py`; stable report digest loop after synthesis | fixed-point convergence test |

## Preserved boundaries

- No duplicate Gate 14 or second CI subsystem was created.
- No second gate dispatcher was created.
- Existing environment, Tree-sitter, Gate 20, MCP-first and canonical finding contracts remain authoritative.
- Kernel source YAML remains retained under `config/kernels/` with exact supplied IDs and versions.
