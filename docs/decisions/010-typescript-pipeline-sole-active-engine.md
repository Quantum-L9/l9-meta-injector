# ADR-010: Use the TypeScript pipeline as the sole active engine

## Status

Accepted (retrospective)

## Date

2026-07-23

## Context

The repository contains a production TypeScript package under `src/` and a historical Python consolidation implementation under `tools/consolidation/`. Both encode related concepts, but operating them as peer runtimes would create competing schemas, execution paths, tests, and release expectations.

The shipped npm package, public API, generated `dist/`, tests, and CI all operate on the TypeScript implementation. Future contributors need one unambiguous runtime authority.

## Options Considered

### Option A: Keep TypeScript and Python as co-equal active engines

- Pros: preserves both implementations as immediately executable alternatives; may ease comparison during migration.
- Cons: doubles compatibility obligations; allows behavioral and schema drift; requires duplicate CI and release governance; obscures which engine consumers should trust.

### Option B: Make Python authoritative and retain TypeScript as a package wrapper

- Pros: reuses the older consolidation implementation as the conceptual center.
- Cons: conflicts with the shipped npm surface and current CI; adds a cross-language runtime dependency; reverses the repository's established package direction.

### Option C: Make TypeScript authoritative and retain Python as historical reference

- Pros: aligns authority with the shipped package, active tests, public contracts, and CI; keeps historical material available for traceability; minimizes duplicate governance.
- Cons: useful Python behavior must be deliberately ported rather than implicitly inherited; the archive must be clearly marked non-normative.

## Decision

We choose **Option C**. The TypeScript pipeline under `src/`, with `runPipelineAsync` as the orchestration entrypoint, is the sole active engine. The Python consolidation tree remains reference-only and is not shipped or CI-gated.

## Consequences

- New runtime behavior belongs in the TypeScript pipeline and its tests.
- Historical Python files do not define active schemas, compatibility promises, or release behavior.
- Useful concepts from the archive may be ported only through an explicit reviewed change.
- Documentation and agents must not describe the repository as a dual-engine system.
- `docs/architecture-authority.json` and `npm run check:authority` enforce the active-engine boundary.
