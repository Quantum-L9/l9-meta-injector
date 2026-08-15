# ADR-029: Release 4.0.0 by immutable commit before migrating consumers

## Status

Accepted for implementation; publication remains separately authorized.

## Decision

The breaking carrier, transaction, and frontmatter changes converge in `v4.0.0`.
A consumer must pin the final 40-character release commit. GitHub commit/tag consumption
is sufficient for `l9-deploy`; npm publication is optional and remains blocked until its
independent evidence and owner-approval contract is satisfied.

`l9-deploy` must declare one canonical writer, remove its Python injector/verifier, route
local checks through the packed CLI, route CI through the exact-SHA composite Action, and
materialize one canonical metadata index before merge.

## Consequences

- No consumer migration can be rendered against `main`, a branch, or a guessed release SHA.
- Open consumer pull requests must be reconciled before applying the pinned migration.
- A release candidate may be validated without authorizing a tag, GitHub release, or npm publish.
