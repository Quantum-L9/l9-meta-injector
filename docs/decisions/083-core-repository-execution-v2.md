# ADR-083: Adopt Core repository execution V2 without bypassing the publication gate

## Status

Proposed with this change. ADR-082 is reserved by the independently open producer-foundation PR #127.

## Context

Central Core requires this repository to declare a repository-execution contract. The V2 contract is a three-field declaration; the released `make-v1` facade must be byte-identical to Core's template, and repository-owned `Repo.mk` must implement the four phases. The previous root `Makefile` also owned `make pr` and `make pr-check`, including a fail-closed local gate before any push.

## Decision

Adopt `l9.repo-execution/v2` and the unmodified `make-v1` facade. Move the existing publication targets and their recipes unchanged into `Repo.mk`, where the facade includes them. Implement Core's phases with the repository's existing commands:

- `setup`: `npm ci --ignore-scripts` (the same locked install as CI).
- `validate`: `npm run check:authority` and `npm run check:manifest`.
- `check`: `npm run lint`.
- `test`: `npm run validate`, the canonical full validation including typechecking, Vitest, API, authority, manifest, distribution, selfpack, packed-consumer and release-candidate checks.

The canonical gate remains `npm run lint` plus `npm run validate`; publication remains `make pr`, with the same clean-worktree check and optional governance check. The phase split intentionally runs the full canonical validation once, rather than a second standalone Vitest run. Node 22.13 or newer is still required for development; the current Core Ubuntu runner provides Node 22. This change neither changes package publication authorization nor chooses a Core revision for the consumer.

Core creates SDK, toolchain-alignment, and capability files under `.l9/runtime/` before repository verification. Ignore that disposable subtree so it neither makes the tree-bound validation report stale nor dirties the checkout. The `.l9` contract and metadata files remain trackable; the ignore rule is not a blanket exclusion of `.l9/`.

## Validation and limits

Core's pinned admission code must accept the exact contract, facade and `Repo.mk` ABI and execute all four phases. Regression tests exercise phase routing and failure propagation without pushing. The architecture manifest includes the new execution inputs and is regenerated. A local pass is not a claim that all remote CI or branch-protection checks passed; those must be observed separately on the PR.
