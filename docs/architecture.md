# Architecture

## Authority

This document describes the as-built TypeScript metadata-injection package. The machine-readable authority index is `docs/architecture-authority.json`; active contracts, decisions, traceability, and repository structure are defined by the adjacent active corpus.

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

## Validation

The current CI gate runs installation, build, typecheck, tests, selfpack, authority validation, and architecture-manifest validation.

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run selfpack
npm run check:authority
npm run check:manifest
```

Committed package-mirror parity and installed-tarball testing remain pending RAA-006.

## Public package boundary

`runPipelineAsync` is the primary stable orchestration entrypoint. The current broad root barrel is transitional and remains unchanged in PR-1. Its final stability tiers and explicit subpaths are pending RAA-007; see `docs/public-api.md`.

## Historical implementation

An earlier Python consolidation engine is retained under `tools/consolidation/` for provenance. Its documentation and schemas are archived under `docs/legacy/consolidation-v1/` and `tools/consolidation/schemas/`. It is not part of the npm package, CI runtime, active contract corpus, or TypeScript taxonomy authority.
