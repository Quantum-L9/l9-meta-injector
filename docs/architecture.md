# Architecture

## Authority

This document describes the as-built TypeScript metadata-injection package. The machine-readable authority index is `docs/architecture-authority.json`; active contracts, decisions, traceability, package rules, and repository structure are defined by the adjacent active corpus.

The shipped package loads `dist/index.js`, whose source is the TypeScript implementation under `src/`. The full orchestration entrypoint is `runPipelineAsync` in `src/pipeline.ts`.

## Primary engine - TypeScript pipeline

```text
retrieval -> extract -> classify -> normalize_meta
                                   |
                          optional assist
                                   |
                     inject <- reconcile_fields
                                   |
                                verify
                                   |
       dedup | placement | MetaV3 | inventory | indexes
```

### Stage responsibilities

| Stage | Module | Responsibility |
|---|---|---|
| retrieval | `retrieval.ts`, `pipeline.ts` | Discover and scan files under the configured root. |
| extract | `extract.ts` | Compute content identity, token estimate, and body-derived fields. |
| classify | `classify.ts`, `artifact_class.ts` | Infer canonical artifact type and semantic class. |
| normalize | `normalize_meta.ts` | Build the typed flat metadata record. |
| assist | `assist.ts`, `llm.ts` | Optionally improve prose-origin fields; local default makes no network calls. |
| inject | `inject.ts`, `comment.ts` | Select a file-aware injection strategy while preserving the source body. |
| reconcile | `reconcile_fields.ts` | Merge prior and incoming metadata with an observable field-diff log. |
| verify | `verify.ts` | Validate the persisted result and body-preservation invariant. |
| dedup | `compiler.ts` | Produce exact and near-duplicate analysis. |
| placement | `placement_policy.ts` | Compile advisory placement plans. |
| MetaV3 | `meta_v3.ts` | Produce the additive nine-plane representation. |
| inventory | `inventory.ts` | Walk a tree and emit inventory records and manifests. |

## Cross-cutting contracts

- `src/schema.ts` owns shared TypeScript contract types.
- Injection must preserve the original body bytes.
- Reinjection must not duplicate metadata blocks.
- Verification failures are exposed through `PipelineResult.verification`.
- Coverage includes skipped inputs and failed verification.
- LLM and IO hot paths expose correlated diagnostics and run-level metrics.
- Persisted indexes are produced by the TypeScript pipeline.

## Committed distribution model

The repository retains compiled JavaScript, declarations, and source maps under `dist/`.

`npm run check:dist` copies `src/` and `tsconfig.json` into an isolated build sandbox, uses the repository-pinned TypeScript compiler, and compares the generated tree to committed `dist/` by file set and SHA-256. It also rejects a pre-dirty or symlinked `dist/` tree.

`npm run test:packed` creates the npm tarball outside the checkout, validates it against `docs/package-contract.json`, installs it into a clean temporary consumer, executes a dry-run pipeline smoke test, and compiles against the packaged declarations.

## Validation

The canonical local and CI gate is:

```bash
npm ci
npm run validate
```

`npm run validate` performs type checking, Jest, authority validation, deterministic architecture-manifest validation, committed-dist parity, selfpack, and packed-consumer runtime and declaration tests. CI then verifies that validation left the immutable checkout clean.

`prepack` runs authority, manifest, and dist-parity gates. `prepublishOnly` runs the full validation command.

## Public package boundary

`runPipelineAsync` is the primary stable orchestration entrypoint. The current broad root barrel remains transitional. RAA-006 proves the root artifact can be packed, installed, executed, and typechecked; it does not assign stability to every low-level export. Explicit subpaths and separate runtime/declaration inventories remain pending RAA-007.

## Historical implementation

An earlier Python consolidation engine is retained under `tools/consolidation/` for provenance. Its documentation and schemas are archived under `docs/legacy/consolidation-v1/` and `tools/consolidation/schemas/`. It is not part of the npm package, CI runtime, active contract corpus, or TypeScript taxonomy authority.
