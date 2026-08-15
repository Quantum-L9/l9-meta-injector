# Repository Manifest

## Active authority

- Runtime: `src/pipeline.ts#runPipelineAsync`
- Metadata: `src/schema.ts`
- Public API: `docs/public-api-contract.json`
- Package: `docs/package-contract.json`
- Architecture: `docs/architecture-authority.json`
- Traceability: `docs/traceability-map.json`

## Public source entrypoints

- `src/index.ts`
- `src/public/inventory.ts`
- `src/public/schema.ts`
- `src/public/advanced.ts`
- `src/public/llm.ts`

## Validation

- `npm run check:api`
- `npm run check:authority`
- `npm run check:manifest`
- `npm run check:dist`
- `npm run selfpack`
- `npm run test:packed`
- `npm run validate`

## Publication

`npm run check:publication` is intentionally outside `validate` and inside `prepublishOnly`. Implementation and packaging can converge while publication remains blocked on external evidence.

## Historical boundary

Legacy consolidation documentation and Python schemas remain under `docs/legacy/consolidation-v1/` and `tools/consolidation/`. They are not public package contracts.
