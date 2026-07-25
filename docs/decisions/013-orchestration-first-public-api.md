# ADR-013: Use an orchestration-first public API with explicit subpaths

## Status

Accepted (retrospective)

## Date

2026-07-23

## Context

The package contains a complete orchestration pipeline and many lower-level primitives. Exposing every primitive from the root creates an accidental compatibility surface, while exposing only one root function prevents legitimate standalone inventory, schema, and advanced composition use cases.

The package needs a stable default path, deliberate lower-level entrypoints, and enforceable import boundaries.

## Options Considered

### Option A: Export all primitives from the package root

- Pros: maximum convenience; simple discovery; no subpath selection.
- Cons: turns internal helpers into permanent compatibility promises; encourages callers to bypass stage ordering and verification; makes semver control difficult.

### Option B: Export only the complete orchestration root

- Pros: smallest stable surface; strongly encourages the safe execution path.
- Cons: blocks valid standalone inventory and schema consumers; forces advanced users toward unsupported deep imports or repository forks.

### Option C: Keep an orchestration-first root and define explicit stable and experimental subpaths

- Pros: gives most consumers one safe default; supports legitimate lower-level use through named contracts; separates stable from experimental obligations; allows unlisted deep imports to be denied.
- Cons: requires runtime and declaration contract maintenance for each subpath; experimental callers must accept additional obligations.

## Decision

We choose **Option C**. The package root remains orchestration-first. `inventory` and `schema` are explicit stable subpaths. `advanced` and `advanced/llm` are explicit experimental subpaths. Unlisted deep imports are denied.

## Consequences

- `package.json#exports`, runtime exports, declaration exports, and `docs/public-api-contract.json` must remain synchronized.
- The root does not become a convenience barrel for low-level primitives.
- Experimental composition callers own stage ordering, coverage accounting, verification aggregation, diagnostics, and deterministic persistence.
- Public API changes follow semantic versioning and require contract and packed-consumer validation.
- Unsupported source or `dist/` deep imports must continue to fail.
