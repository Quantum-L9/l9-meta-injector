# l9-meta-injector CHANGELOG

## Unreleased

## 4.0.0 - 2026-08-01

### Breaking

- Replaced syntax-selected metadata writes with explicit `hard_skip`, `inventory_only`, `central_manifest`, and `inline_managed` carrier authority.
- Made `.l9/metadata-index.jsonl` the canonical deterministic metadata store for non-inline subjects.
- Unified check and apply through one carrier plan and removed legacy adjacent-sidecar dispatch.
- Made apply a journaled whole-run transaction with compare-and-swap, rollback, and interrupted-run recovery.
- Replaced whole-header YAML serialization with byte-preserving managed-field frontmatter patching.

### Security and assurance

- Added fail-closed hidden control-surface authority scanning, strict operation modes, immutable Action pins, path containment, deterministic discovery, and exact repository-relative identity.
- Restricted ordinary inline YAML to plain Markdown and made ambiguous or complex frontmatter non-mutating.

### Distribution

- Added the `l9-meta-injector` executable to the packed artifact and included the runtime scripts needed for immutable Git-SHA consumption.
- Corrected the stale package-lock identity and added a release-candidate gate.

### Migration

- Added `docs/migrations/v3-to-v4.md`. Consumers must declare `.l9/meta-authority.yaml`, pin a 40-character release commit, and remove competing metadata writers.

### Carried forward

- `--local-files` archive expansion and the ADR-016 through ADR-018 omit/skills behavior introduced after 3.0.0 are included in this release.

## 3.0.0 - 2026-07-22

### Breaking

- Replaced the broad root barrel with an orchestration-first stable root.
- Added stable `./inventory` and `./schema` entrypoints.
- Added experimental `./advanced` and `./advanced/llm` entrypoints.
- Denied unlisted deep imports through an explicit package export map.

### Assurance

- Added separate runtime and declaration export inventories.
- Added source, package-map, installed-tarball, declaration, and deep-import validation.
- Added a publication decision gate so unresolved package history blocks publishing without blocking implementation or CI.

### Migration

- Added `docs/migrations/v2-to-v3.md` with import mappings.

## 2.1.0 - 2026-06-19

Introduced the TypeScript metadata injection pipeline, LLM-assisted prose reconciliation, namespace handling, filename normalization, and body-preserving verification.
