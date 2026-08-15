# tools/consolidation - secondary engine (reference only)

> **Status: out of scope for the shipped package.** This Python consolidation tool is not the authoritative metadata-injection engine. The authoritative engine is the TypeScript pipeline under `src/`, shipped through `dist/`.

## Historical context

This directory contains an earlier two-mode consolidation engine. Its active-era contracts, decisions, traceability map, and manifest are archived at `docs/legacy/consolidation-v1/`.

Its historical schemas now live beside the implementation under `tools/consolidation/schemas/`. They are not public TypeScript package schemas and are excluded from the npm package allowlist.

## Why it is reference-only

| | Python reference tool | Authoritative TypeScript package |
|---|---|---|
| Shipped by npm | No | Yes |
| Run by CI | No | Yes |
| Covered by selfpack | No | Yes |
| Owns current package contracts | No | Yes |

New feature work, remediation, schemas, and release gates target the TypeScript package. This directory may be inspected for provenance but must not be used as an active source of truth.
