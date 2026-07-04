# l9-meta-injection-pack CHANGELOG

## v2.1.0 — 2026-06-19

### New modules
- `assist.ts` — LLM assist layer for prose-origin fields only
  - `isGoodValue()` predicate (≥8 word tokens, non-Unknown, non-empty)
  - `assistField()` — seeds with regex, calls LLM only when seed fails predicate
  - `isMateriallyBetter()` — ~20-token boolean LLM judgment for scalar fields
  - `PROSE_ORIGIN_FIELDS` / `GRAMMAR_ORIGIN_FIELDS` sets — explicit classification
- `reconcile_fields.ts` — Five-way field reconciliation engine
  - Actions: `add` / `revise` / `append-union` / `keep` / `replace`
  - List fields (`activation_signals`, `triggers`, `anti_triggers`, `entity_types`, etc.) always union-merge, never overwrite
  - `replace` only on explicit deprecation marker (`deprecated: true`, `superseded_by:`, `status: deprecated`)
  - `diffsToLogYaml()` — sidecar audit log writer
- `namespace.ts` — Deterministic path → namespace + sharing_scope + primitive_folder
  - `resolveNamespace()` — reads `namespaceGlobs` from `namespace.config.json`
  - `toSnakeStem()` — camelCase/hyphen/space → snake_case
  - `idStem` format: `<namespace>.<primitive_folder>.<snake_stem>`
- `normalize_filename.ts` — snake_case filename normalizer
  - Preserves dot-convention prefix (`ns.primitive.Stem.md`) and `Prompt-` prefix
  - Dry-run: writes sidecar `.normalize.log.yaml` only, never renames
  - Live: sidecar written, rename is a separate explicit pass

### Modified modules
- `llm.ts` — Full async `classify?` method; `makeOpenAIAdapter()` factory (OpenAI + Ollama compatible)
- `schema.ts` — Added `SharingScope`, `namespace`/`sharing_scope` to `BaseHeader`; `FieldDiff` type
- `inject.ts` — Five-way reconciliation on every inject; `.inject.log` sidecar on mutations
- `verify.ts` — `sharing_scope` cross-reference invariant check
- `pipeline.ts` — Wires assist pass, filename normalization, LLM adapter flags
- `normalize_meta.ts` — Uses `resolveNamespace()` for `id`, `namespace`, `sharing_scope`

### Key invariants
- Default mode: zero LLM calls (local adapter only)
- `--llm` flag enables prose-field assist (OpenAI-compatible or Ollama)
- Body is ALWAYS preserved byte-for-byte
- No silent field mutations — every change is in `.inject.log`
- `sharing_scope=shared` requires `namespace=shared|core` — enforced by verify

### Test coverage
- 56 tests across 7 suites (0 failures)
