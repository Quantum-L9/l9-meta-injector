# Consolidation v1 Archive

## Status

This directory contains the historical Python consolidation architecture that predated the shipped TypeScript package.

It is retained for provenance only. It is not an active source of package contracts, runtime authority, release gates, public schemas, or implementation requirements.

## Superseding authority

- Runtime architecture: `docs/architecture.md`
- Machine-readable authority index: `docs/architecture-authority.json`
- Active contracts: `docs/contracts.md`
- Active decisions: `docs/decision_log.md`
- Active traceability: `docs/traceability-map.json`
- Active repository manifest: `docs/manifest.md`
- Authoritative engine: `src/pipeline.ts` and the TypeScript modules under `src/`

## Historical runtime

The corresponding Python implementation remains under `tools/consolidation/` as reference-only code. Its schemas live under `tools/consolidation/schemas/` and are excluded from the npm package contract.

Do not promote material from this archive back into the active corpus without a new architecture decision and regression evidence.
