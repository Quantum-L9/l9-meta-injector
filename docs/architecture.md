# Architecture

This document describes the **as-built primary artifact**: the TypeScript
metadata-injection pipeline shipped as the `l9-meta-injector` npm package
(`package.json` → `main: dist/index.js`). A second, older Python consolidation
engine lives under `tools/consolidation/`; it is **secondary and out of scope**
for the shipped package (see [Engine authority](#engine-authority) below and
decision #10 in `decision_log.md`).

## Primary engine — TypeScript pipeline

Source in `src/*.ts`, compiled output committed to `dist/`, tests in `tests/*.ts`,
snapshot smoke test in `scripts/selfpack.js`. The library entry point is
`runPipelineAsync` in `src/pipeline.ts`.

```
retrieval ─▶ extract ─▶ classify ─▶ normalize_meta (buildMeta)
                                          │
                              assist (LLM prose fill, opt-in)
                                          │
                                        inject  ◀─ reconcile_fields (5-way merge)
                                          │
                                        verify
                                          │
        ┌─────────────────┬───────────────┼────────────────┬───────────────┐
     dedup            placement         meta_v3          inventory        indexes
 (near-dup report)   (compiler)     (9-plane model)   (tree walker)   (library JSON)
```

### Stage responsibilities

| Stage | Module | Responsibility |
|---|---|---|
| retrieval | `retrieval.ts`, `pipeline.ts` | Discover files under a root by glob; scan and read bodies. |
| extract | `extract.ts` | Content hash, token estimate, prose-field extraction from the body. |
| classify | `classify.ts`, `artifact_class.ts` | Infer `artifact_type` (coarse) and semantic class (fine) from path + content. |
| normalize_meta | `normalize_meta.ts` | `buildMeta` assembles the typed `NormalizedMeta` header per artifact type. |
| assist | `assist.ts`, `llm.ts` | Opt-in LLM fill for prose-origin fields when the regex seed fails the "good" predicate. Local default makes **no** network calls. |
| inject | `inject.ts`, `comment.ts` | Filetype-aware injection: YAML frontmatter (markdown), comment-wrapped block (code), or `.l9meta.yaml` sidecar (comment-less/binary). Body preserved verbatim. |
| reconcile | `reconcile_fields.ts` | Five-way field merge (add / revise / append-union / keep / replace) on re-injection; every mutation logged. |
| verify | `verify.ts` | Post-injection checks: YAML valid, body preserved (hash), taxonomy valid, sharing-scope valid, prompt-schema complete. |
| dedup | `pipeline.ts` | Shingle-Jaccard near-duplicate report over injected bodies. |
| placement | `compiler.ts`, `placement_policy.ts` | Advisory placement plans (one per injected artifact). |
| meta_v3 | `meta_v3.ts` | Nine-plane v3 metadata record, additive over v1/v2. |
| inventory | `inventory.ts` | Standalone tree walker → inventory records + folder/file sidecars. |
| serialization | `yaml_serialize.ts`, `meta_schema.ts` | Single canonical writer (`serializeYamlObject`) and reader (`parseCanonicalYaml`) for the constrained YAML subset. |
| taxonomy | `taxonomy.ts`, `schema.ts` | `ArtifactType` is the canonical vocabulary; finer classifications map onto it. |

### Cross-cutting contracts

- **Schema single-source** — `src/schema.ts` owns `NormalizedMeta`, `SharingScope`,
  `FieldDiff`/`ReconcileAction`, the taxonomies, and the `MetaRecord` reconcile-edge
  type. Consumers import from there rather than re-declaring.
- **Body preservation** — injection never alters the artifact body; verification
  asserts `postInjectionBodyHash === originalBodyHash`.
- **Idempotency** — re-injecting a stamped file is a byte-level no-op (sentinels let a
  re-run replace, not duplicate, the header). `selfpack` asserts `rerunFilesChanged=0`.
- **Observability** — the LLM/IO hotpaths report a correlated decision path
  (`llm_ok` / `llm_failed_fallback` / `no_adapter` / `heuristic`) and run-level metrics
  (`src/metrics.ts`), surfaced on `PipelineResult.metrics`.

### Verify gate (CI parity)

```
npm ci && npm run build && npm run typecheck && npm test && node scripts/selfpack.js
```

This is exactly what CI (`ci.yml` → `smoke`) runs. `dist/` is kept in sync with `src/`
in the same commit.

## Engine authority

Two metadata-injection engines exist in this repository with divergent header
dialects (finding ACA-001):

| | Primary | Secondary |
|---|---|---|
| Engine | TypeScript pipeline (`src/`, shipped as `dist/`) | Python consolidation (`tools/consolidation/`) |
| Status | **Authoritative** — the npm package, tested + CI-gated | Out of scope for the package; retained for reference |
| Header dialect | `>>> l9:meta >>>` sentinels / YAML frontmatter / sidecar | `L9_META` / `L9_ARTIFACT_META` stamps |
| Consumed by | `package.json` `main`, tests, selfpack | Nothing in the shipped package |

**Decision:** the TypeScript pipeline is the single authoritative engine. New feature
work, findings remediation, and the header-dialect contract target the TS engine. The
Python tool is not wired into CI, `dist/`, or the package `files` allowlist, and is not
maintained in lockstep; it is documented below for historical context only. See
`tools/consolidation/README.md` and `decision_log.md` (#10).

## Secondary engine — Python consolidation (reference only)

The Python tool predates the TS pipeline and implements a two-mode consolidation
(repo-pack in-place stamping; folder-artifact copy-only). It is retained for reference
and is **not** part of the shipped package.

```
ingress.py (single entry, validates + routes)
         │
    core/ (shared, mode-neutral)
    scanner → hasher → classifier → path_planner → dedup_gate
         │
    manifest gate (validates move_map.csv before any write)
         │
    modes/<mode>/injector.py
```

| Module | Responsibility |
|---|---|
| `scanner.py` | Walk source, skip hidden/system, emit `(rel_path, abs_path, ext)` |
| `hasher.py` | SHA-256 per file; basis for dedup and idempotency |
| `classifier.py` | Infer artifact_type, domain, node_name, confidence from path+content |
| `path_planner.py` | Map each file to a proposed `output_path` from domain hints |
| `dedup_gate.py` | Detect duplicate hashes and output_path collisions |

Its `move_map.csv` artifact_type vocabulary
(`architecture│contract│node_spec│infra│template│skill│unknown`) is distinct from the
TS `ArtifactType` and is **not** mapped in `src/taxonomy.ts` — the TS package never
reads it (finding RAA-003).
