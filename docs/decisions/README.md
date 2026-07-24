# Architecture Decision Records

This directory contains the accepted decisions that govern the active `l9-meta-injector` architecture.

## Numbering

- ADR-001 through ADR-009 remain represented by the historical decision corpus under `docs/legacy/consolidation-v1/`.
- ADR-010 onward governs the active TypeScript package.
- Numbers are never reused.

## Status lifecycle

Use one of:

- `Proposed`
- `Accepted`
- `Deprecated`
- `Superseded by ADR-XXX`

Accepted ADRs are not deleted. A replacement ADR links back to the decision it supersedes, and the older ADR links forward to its replacement.

## Active ADRs

| ADR | Decision | Status |
|---|---|---|
| [ADR-010](010-typescript-pipeline-sole-active-engine.md) | TypeScript pipeline is the sole active engine | Accepted |
| [ADR-011](011-one-active-architecture-corpus.md) | Maintain one active architecture corpus | Accepted |
| [ADR-012](012-committed-dist-with-parity-proof.md) | Retain committed dist with source and tarball parity proof | Accepted |
| [ADR-013](013-orchestration-first-public-api.md) | Use an orchestration-first public API with explicit subpaths | Accepted |
| [ADR-014](014-layered-ci-gates.md) | Use layered CI with aggregate and independent gates | Accepted |
| [ADR-015](015-fail-closed-publication.md) | Keep npm publication fail-closed pending external evidence | Accepted |

## Authority boundary

ADRs explain why decisions exist. Machine-readable contracts and executable validators remain the enforcement authority. When an ADR and an executable contract appear inconsistent, treat the state as drift and reconcile it through a reviewed change rather than silently choosing one.
