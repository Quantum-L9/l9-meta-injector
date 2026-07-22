# Repository Manifest - l9-meta-injector

## Active package

- Runtime authority: `src/pipeline.ts#runPipelineAsync`
- Contract authority: `src/schema.ts`
- Package entrypoint: `dist/index.js`
- Type entrypoint: `dist/index.d.ts`
- Architecture authority: `docs/architecture-authority.json`
- Active contracts: `docs/contracts.md`
- Active decisions: `docs/decision_log.md`
- Public API policy: `docs/public-api.md`
- Traceability: `docs/traceability-map.json`
- Integrity manifest: `docs/architecture-manifest.json`

## Active subsystems

- retrieval
- extraction
- classification
- metadata normalization
- optional LLM assistance
- file-aware injection
- reconciliation
- persisted-result verification
- coverage accounting
- deduplication
- placement compilation
- additive MetaV3 indexing
- inventory mode

## Generated and published artifacts

- committed `dist/` JavaScript, declarations, and source maps;
- active schemas under `schemas/`;
- examples;
- `README.md`;
- `CHANGELOG.md`.

Distribution parity and installed-tarball proof remain pending RAA-006.

## Historical implementation

- Documentation archive: `docs/legacy/consolidation-v1/`
- Runtime reference: `tools/consolidation/`
- Historical schemas: `tools/consolidation/schemas/`
- Status: reference-only and excluded from active package authority
