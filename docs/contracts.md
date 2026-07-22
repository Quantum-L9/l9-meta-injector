# Active TypeScript Package Contracts

## Authority

The shipped `l9-meta-injector` npm package is governed by:

- `docs/architecture-authority.json` for machine-readable authority;
- `docs/architecture.md` for the as-built system description;
- `src/schema.ts` for shared TypeScript contract types;
- `src/pipeline.ts#runPipelineAsync` for full-pipeline orchestration;
- `package.json` for distribution entrypoints;
- `.github/workflows/ci.yml` and `scripts/selfpack.js` for release validation.

Historical consolidation material is reference-only under `docs/legacy/consolidation-v1/` and `tools/consolidation/`.

## Pipeline input

`runPipelineAsync` accepts `PipelineConfig` from `src/schema.ts`.

Required responsibilities include:

- identify a filesystem root and glob;
- select dry-run or mutation mode;
- supply namespace and authority values;
- provide output and index directories;
- configure deduplication thresholds;
- explicitly enable or disable LLM assistance;
- explicitly enable or disable filename normalization.

JavaScript callers are responsible for providing the complete runtime shape even when TypeScript declarations are not enforced.

## Pipeline result

The orchestration boundary returns `PipelineResult`, including:

- scanned entries;
- injection records;
- per-file verification records;
- an aggregated verification decision;
- coverage and skipped-input accounting;
- placement plans;
- additive MetaV3 records;
- run-level metrics.

A caller must not claim success when `verification.passed` is false.

## Metadata authority

`src/schema.ts` owns the shared metadata vocabulary. `NormalizedMeta` is the canonical flat record used by injection and verification. `MetaV3` is additive and does not replace the flat record.

Unset values use the explicit `Unknown` sentinel where the TypeScript contract permits it. Unsupported values must not be invented.

## Mutation semantics

- Dry-run mode may write review artifacts only under the configured output directory.
- Mutation mode may write metadata to a supported file header, comment block, or sidecar.
- The source body must remain byte-stable after metadata injection.
- Reinjection must replace or retain existing metadata without duplicating the injected block.
- Every material metadata mutation must remain observable in an injection log when logging is enabled.

## Verification and coverage

Verification checks the persisted result, body preservation, taxonomy, sharing scope, and prompt completeness where applicable. Coverage reports scanned, injected, skipped, and failed-verification counts together with skipped paths.

Binary and non-injectable inputs are explicit coverage outcomes, not silent omissions.

## Persisted outputs

A non-dry run may persist:

- `primitive-library-index.json`;
- `prompt-library-index.json`;
- `dedup-report.json`;
- `dedup-report.md`;
- `verification-report.json`;
- `placement-plan.json`;
- `meta-v3-index.json`.

Each output is owned by the TypeScript pipeline or its called TypeScript compiler stage.

## Distribution contract

The package currently ships committed JavaScript and declarations under `dist/`. Source-to-package parity is not considered proven until RAA-006 adds a deterministic distribution gate and packed-consumer test.

## Public API contract

`runPipelineAsync` is the primary supported orchestration entrypoint. The current root barrel exposes additional low-level modules as a transitional state. Their final stability and subpath boundaries remain pending RAA-007. PR-1 does not narrow or expand runtime exports.

## Release blockers

Release is blocked when:

- active architecture documents disagree about the authoritative engine;
- an authority-index reference is missing;
- a historical contract appears in the active authority corpus;
- the architecture manifest is stale;
- verification fails;
- committed package artifacts are proven stale;
- a claimed public boundary is not testable from the packed artifact.
