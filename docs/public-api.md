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
| `l9-meta-injector/repository-model` | stable | Deterministic `l9.repository-model` packet construction, validation, and bundle emission |

## Root contract

The root exposes `runPipelineAsync` and `runSkillsPipelineAsync` plus shared constants and types needed to configure and consume a run. It does not expose injection primitives, parsers, compiler internals, or adapter mutation. Inventory and pipeline never mutate `SKILL.md`; skills mode is the Cursor-native path (ADR-017).

## Advanced caller obligations

A caller composing low-level primitives must own orchestration order, body-preservation verification, coverage accounting, skipped-input handling, reconciliation logs, error propagation, metrics, output sequencing, and persisted-report completeness. The advanced surface does not silently recreate the pipeline.

The LLM adapter is process-global. Multi-tenant or concurrent callers must isolate processes or serialize adapter changes.

## Repository model contract

`l9-meta-injector/repository-model` converts an inventory observation into an
`l9.repository-model` packet bundle for the `l9-constellation-topology` consumer. It builds,
validates, and emits; it does not import, execute, or depend on topology at runtime.

Callers must supply the source revision explicitly — it is never inferred. Semantic identity
is independent of the local checkout path, and repeated construction over the same
observation yields the same `semantic_hash` and `packet_id`.

Domains without supporting evidence stay empty and are reported as diagnostics. Capabilities
are always empty from this producer; relationships carry only observed `CONTAINS` edges.
See ADR-030 and `docs/topology-conformance.json`.

## Runtime and declarations

TypeScript types are erased at runtime. Runtime exports are verified with module-key inventories. Declaration exports are verified by compiling a clean consumer against the installed tarball. These contracts are deliberately separate.

## Deep imports

Only paths listed in `package.json#exports` are supported. Imports such as `l9-meta-injector/dist/schema` are rejected with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Migration

See `docs/migrations/v2-to-v3.md` for mappings from the former broad root barrel.
