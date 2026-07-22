# Active TypeScript Package Contracts

## Authority

The shipped `l9-meta-injector` npm package is governed by:

- `docs/architecture-authority.json` for machine-readable authority;
- `docs/architecture.md` for the as-built system description;
- `src/schema.ts` for shared TypeScript contract types;
- `src/pipeline.ts#runPipelineAsync` for full-pipeline orchestration;
- `package.json` for lifecycle commands and distribution entrypoints;
- `docs/package-contract.json` for tarball inclusion and exclusion rules;
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

The orchestration boundary returns `PipelineResult`, including scanned entries, injection records, per-file verification records, an aggregated verification decision, coverage, placement plans, additive MetaV3 records, and run-level metrics.

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

The package uses a committed-distribution model:

1. `src/` and `tsconfig.json` are copied into an isolated temporary build root.
2. The repository-pinned compiler emits a fresh temporary `dist/` tree.
3. The temporary tree and committed `dist/` must have the same regular-file set and byte digests.
4. Dirty, untracked, missing, extra, changed, or symlinked `dist/` entries fail closed.
5. `npm pack` writes outside the checkout and is validated against `docs/package-contract.json`.
6. The tarball's `dist/` tree must exactly match committed `dist/`.
7. The tarball must install into a clean consumer, execute through its packaged runtime entrypoint, preserve dry-run input bytes, and compile through its packaged declarations.

`prepack` enforces authority, manifest, and dist parity. `prepublishOnly` runs the complete `npm run validate` gate.

## Package inclusion contract

Required package files, allowed top-level paths, and forbidden legacy/source/tooling paths are machine-readable in `docs/package-contract.json`.

Schemas under `schemas/` are allowed package data. RAA-006 does not certify their semantics; schema conformance remains the responsibility of dedicated schema and interface audits.

## Public API contract

`runPipelineAsync` is the primary supported orchestration entrypoint. The current root barrel exposes additional low-level modules as a transitional state. RAA-006 proves the packed root artifact only. Final stability, runtime export inventories, declaration inventories, and subpath boundaries remain pending RAA-007.

## Release blockers

Release is blocked when:

- authority or architecture-manifest validation fails;
- verification fails;
- committed `dist/` differs from an isolated source build;
- the checkout contains dirty or untracked distribution files;
- the tarball violates the package contract;
- the installed runtime smoke test fails;
- the packaged declarations fail consumer compilation;
- canonical validation leaves the checkout dirty;
- a claimed public boundary is not testable from the packed artifact.
