# L9 Component Verification Report

Target: package component surface for `l9-meta-injector`
Mode: audit-component + verify-component + probe
Mutation: none

## Components verified

| Component | Source path | Public/export status | Evidence |
|---|---|---|---|
| Schema/types | `src/schema.ts` | Exported via `src/index.ts` | `export * from "./schema"`. |
| LLM adapter | `src/llm.ts` | Exported via `src/index.ts` | `export * from "./llm"`. |
| Namespace utilities | `src/namespace.ts` | Exported via `src/index.ts` | `resolveNamespace`, `toSnakeStem`, types exported. |
| Assist utilities | `src/assist.ts` | Exported via `src/index.ts` | `export * from "./assist"`. |
| Reconciliation | `src/reconcile_fields.ts` | Exported via `src/index.ts` | Functions and types exported. |
| Filename normalization | `src/normalize_filename.ts` | Exported via `src/index.ts` | `export * from "./normalize_filename"`. |
| Extraction | `src/extract.ts` | Exported via `src/index.ts` | `export * from "./extract"`. |
| Classification | `src/classify.ts` | Exported via `src/index.ts` | `export * from "./classify"`. |
| Metadata normalization | `src/normalize_meta.ts` | Exported via `src/index.ts` | `export * from "./normalize_meta"`. |
| Injection | `src/inject.ts` | Exported via `src/index.ts` | `injectFile`, `injectFileAsync`, `InjectOptions` exported. |
| Verification | `src/verify.ts` | Exported via `src/index.ts` | `export * from "./verify"`. |
| Retrieval | `src/retrieval.ts` | Exported via `src/index.ts` | `export * from "./retrieval"`. |
| Pipeline | `src/pipeline.ts` | Exported via `src/index.ts` | `export * from "./pipeline"`. |
| Compiler reports/indexes | `src/compiler.ts` | Not exported from `src/index.ts` | Present in package but not public barrel. Intent Unknown. |

## Runtime probe

Probe method: package validation commands and TypeScript compile against `src/index.ts` export surface.

| Probe | Result | Evidence |
|---|---|---|
| TypeScript compile | Pass | `npm run typecheck` exit code 0. |
| Jest suites | Pass | `npm test` exit code 0, 9 suites / 66 tests passed. |
| Package dry-run | Pass | `npm pack --dry-run` exit code 0, 75 files. |

## Findings

| Finding | Severity | Evidence | Action |
|---|---|---|---|
| `src/compiler.ts` is not exported from public barrel | Low / Unknown | `src/compiler.ts` exists but `src/index.ts` has no compiler export. | Confirm whether compiler helpers are internal or should be public. Do not auto-change. |
| All public components compile and tests pass | Pass | Typecheck/test/package commands pass. | No action required. |

## Verdict

Component surface is wired and loadable. The only Unknown is whether `compiler.ts` is intentionally internal.
