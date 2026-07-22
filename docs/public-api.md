# Public API Policy

## Current state

`runPipelineAsync` is the primary documented orchestration entrypoint.

The package root currently re-exports additional low-level modules. That broad barrel is a transitional compatibility state, not a final stability declaration. PR-1 intentionally leaves runtime exports unchanged.

## Stability labels

- **stable**: semver-governed and supported for external consumers.
- **experimental**: intentionally reachable but may change in a future major release.
- **internal**: repository implementation detail and not a supported package entrypoint.

## Current commitment

Until RAA-007 is implemented:

- `runPipelineAsync` is stable;
- the root barrel remains reachable for compatibility;
- low-level exports have no new stability promise solely because they are reachable;
- direct stage composition transfers orchestration obligations to the caller.

## Caller obligations when bypassing orchestration

A caller composing low-level stages must independently preserve:

- normalization order;
- body-preservation checks;
- verification aggregation;
- coverage and skipped-input accounting;
- metrics and degraded-mode signaling;
- output ordering and persistence;
- error propagation;
- reconciliation logging.

## Pending boundary decision

RAA-007 will separate runtime and declaration inventories, publish explicit subpaths, test them from the installed tarball, and document migration and stability rules. No export should be removed before that work lands with a compatible versioning decision.
