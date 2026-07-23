# Public API Policy

## Current state

`runPipelineAsync` is the primary documented orchestration entrypoint.

The package root currently re-exports additional low-level modules. That broad barrel is a transitional compatibility state, not a final stability declaration. RAA-006 intentionally leaves runtime and declaration exports unchanged.

## Stability labels

- **stable**: semver-governed and supported for external consumers.
- **experimental**: intentionally reachable but may change in a future major release.
- **internal**: repository implementation detail and not a supported package entrypoint.

## Current commitment

Until RAA-007 is implemented:

- `runPipelineAsync` is stable;
- the root barrel remains reachable for compatibility;
- low-level exports gain no new stability promise solely because they are reachable;
- direct stage composition transfers orchestration obligations to the caller.

## Packed artifact proof

RAA-006 validates that the current root package can be packed outside the checkout, installed into a clean temporary consumer, required through `dist/index.js`, exercised through a dry-run pipeline call, and compiled through `dist/index.d.ts`.

That proof covers artifact integrity. It does not define the final public surface. Runtime values and erased TypeScript declarations remain separate contracts for RAA-007.

## Caller obligations when bypassing orchestration

A caller composing low-level stages must independently preserve normalization order, body-preservation checks, verification aggregation, coverage, skipped-input accounting, metrics, output ordering, error propagation, and reconciliation logging.

## Pending boundary decision

RAA-007 will separate runtime and declaration inventories, publish explicit subpaths, test every supported path from the installed tarball, and document migration and stability rules. No export should be removed before that work lands with a compatible versioning decision.
