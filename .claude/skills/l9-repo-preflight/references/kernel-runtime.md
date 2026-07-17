# Governed Kernel Runtime v4

## Purpose

The v4 control plane binds four supplied kernel contracts to existing preflight responsibilities. Kernels are loaded once from `config/kernels/`, validated before repository evaluation, and exposed in every report under `kernel_runtime`.

## Binding map

| Kernel | Runtime binding | Activation point |
|---|---|---|
| `mode_router_kernel.v1` | `scripts/preflight/kernels/mode_router.py` | Before evidence collection and Gate 20 provider resolution |
| `validation_and_errors_kernel.v1` | `scripts/preflight/kernels/validation.py` | Before execution and at component failure boundaries |
| `dependency_audit_kernel.v1` | `scripts/preflight/security/dependency_audit.py` | Gate 15 supply-chain evaluation |
| `convergence_kernel.v1` | `scripts/preflight/kernels/convergence.py` | After report synthesis and before return/package |
| `ci_gate_kernel.v1` | Existing Gate 14 CI integrity contract | Required dependency of dependency audit |

## Fail-closed behavior

- Missing, duplicate, malformed, or unbound required kernels block execution.
- Unresolved required kernel dependencies block execution.
- Runtime component failures become canonical evidence; mandatory failures cannot produce a clear verdict.
- Convergence excludes volatile timestamps and run identifiers, then requires two consecutive identical stable digests.
- A report that cannot reach a fixed point is marked `requires_human_review` and cannot be a full preflight.

## Mode routing

The router distinguishes filesystem versus connector evidence, interactive versus autonomous hosts, remediation authorization, packaging intent, and Gate 20 audit mode. `auto` resolves to host-agent reasoning only when the host advertises that capability; otherwise it resolves to deterministic static mode.

## Dependency audit

Gate 15 inventories supported dependency manifests, lockfiles, version-range drift, and scanner availability. Missing scanners produce `not_observed`; observed compatibility risks remain warnings. Dependency audit does not execute network calls merely to discover credentials or connectivity.
