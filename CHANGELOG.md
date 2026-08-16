# l9-meta-injector CHANGELOG

## Unreleased

### Added

- Added the stable `l9-meta-injector/repository-model` entrypoint, which builds, validates, and emits a deterministic `l9.repository-model` packet bundle from inventory evidence (ADR-030).
- Added `scripts/repository-model-cli.js` (`npm run repository-model`) for executable packet egress.
- Added `scripts/topology-conformance.js` (`L9_TOPOLOGY_CHECKOUT=<checkout> npm run topology:conformance`), which proves the emitted bundle is accepted by the real `l9-constellation-topology` consumer from an ephemeral read-only checkout, and records the bound revision in `docs/topology-conformance.json`.

- Added `AuthorityNotice` and `CheckResult`/`ApplyResult.authorityNotices` for non-blocking authority findings, including the `migration_only` allowance (ADR-034).
- Added `docs/output-placement-contract.md` as the single documented source of truth for where every entrypoint writes.
- Added a `Makefile` with `pr-check` and `pr`. `make pr` is the sanctioned publish path: it runs `npm run lint` and `npm run validate`, refuses a dirty tree, then pushes and opens the pull request, so a push is never separable from the gate it claims to have passed. The Makefile is not part of the packed artifact.

### Fixed

- Boolean CLI flags (`--dry-run`, `--fail-on-issues`, `--llm`, `--llm-allow-insecure`) no longer consume the following option token, so `--dry-run --out reports` parses as intended. `--no-<flag>` is the explicit false form.
- `legacy_writers` now reaches a runtime authority decision instead of existing only in schema validation, and historical `L9_META` marker text plus an unrelated generic file write is no longer classified as an active competing metadata writer (ADR-034).
- Frontmatter outside the inline-patchable subset no longer aborts a repository-wide apply. The file's bytes are preserved, its metadata moves to the central manifest, and a deterministic diagnostic states why (ADR-035).
- An unquoted single-line scalar such as `created: 2025-10-28T15:30:00Z` is carried as an opaque field and preserved verbatim rather than failing inspection (ADR-035).
- `verify` recovers a frontmatter body using the same byte-exact derivation `inject` captured it with. A file that already carried frontmatter followed by a blank line previously failed a body-preservation postcondition and aborted governed apply (ADR-035).
- Refused applies and failing checks now render the authority conflict code, path, message, and evidence, deterministically ordered, with credential-shaped values redacted.
- Plan-mode runs no longer print a phantom `verification FAILED` banner for files that have not been written yet.

### Notes

- Emitted packets are byte-deterministic and independent of the local checkout path. Capabilities and relationships are emitted only where repository evidence supports them; unsupported domains stay empty and are reported as diagnostics. Interpretation is declared-or-observed only: no model, no network, no cross-repository inference.
- The interpretation profile participates in packet identity, so packet semantic hashes change for every repository. The `l9.repository-model` wire contract is unchanged at 1.0.0; facts it has no field for are preserved as evidence plus a `contract-field-unavailable` diagnostic.
- No runtime dependency on `l9-constellation-topology`, Python, or the network is introduced. `npm run validate` remains runnable without a second repository.

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
