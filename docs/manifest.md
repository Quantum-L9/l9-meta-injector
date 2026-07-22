# Repository Manifest - l9-meta-injector

## Active package

- Runtime authority: `src/pipeline.ts#runPipelineAsync`
- Contract authority: `src/schema.ts`
- Package entrypoint: `dist/index.js`
- Type entrypoint: `dist/index.d.ts`
- Architecture authority: `docs/architecture-authority.json`
- Active contracts: `docs/contracts.md`
- Package contract: `docs/package-contract.json`
- Active decisions: `docs/decision_log.md`
- Public API policy: `docs/public-api.md`
- Traceability: `docs/traceability-map.json`
- Integrity manifest: `docs/architecture-manifest.json`
- Release checklist: `docs/release-checklist.md`

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
- `CHANGELOG.md`;
- `LICENSE` and `package.json` as npm standard inclusions.

Distribution integrity is enforced by `npm run check:dist`, `npm run test:packed`, `prepack`, `prepublishOnly`, and the canonical `npm run validate` gate.

## Historical implementation

- Documentation archive: `docs/legacy/consolidation-v1/`
- Runtime reference: `tools/consolidation/`
- Historical schemas: `tools/consolidation/schemas/`
- Status: reference-only and excluded from active package authority
