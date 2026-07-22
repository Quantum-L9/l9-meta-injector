# Public API

`docs/public-api-contract.json` is the machine-readable authority for package entrypoints, runtime values, declaration-only names, stability, and deep-import policy.

## Stability

- **Stable**: semver-governed. Breaking changes require a major version.
- **Experimental**: intentionally public but may change at the next major version.
- **Internal**: not present in `package.json#exports` and not supported.

## Entrypoints

| Import | Tier | Responsibility |
|---|---|---|
| `l9-meta-injector` | stable | Full pipeline orchestration and shared result contracts |
| `l9-meta-injector/inventory` | stable | Standalone inventory and duplicate analysis |
| `l9-meta-injector/schema` | stable | Metadata constants, guards, coercion, and MetaV3 construction |
| `l9-meta-injector/advanced` | experimental | Low-level deterministic composition primitives |
| `l9-meta-injector/advanced/llm` | experimental | Process-global LLM adapter controls |

## Root contract

The root exposes `runPipelineAsync` plus shared constants and types needed to configure and consume a run. It does not expose injection primitives, parsers, compiler internals, or adapter mutation.

## Advanced caller obligations

A caller composing low-level primitives must own orchestration order, body-preservation verification, coverage accounting, skipped-input handling, reconciliation logs, error propagation, metrics, output sequencing, and persisted-report completeness. The advanced surface does not silently recreate the pipeline.

The LLM adapter is process-global. Multi-tenant or concurrent callers must isolate processes or serialize adapter changes.

## Runtime and declarations

TypeScript types are erased at runtime. Runtime exports are verified with module-key inventories. Declaration exports are verified by compiling a clean consumer against the installed tarball. These contracts are deliberately separate.

## Deep imports

Only paths listed in `package.json#exports` are supported. Imports such as `l9-meta-injector/dist/schema` are rejected with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Migration

See `docs/migrations/v2-to-v3.md` for mappings from the former broad root barrel.
