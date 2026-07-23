# l9-meta-injector

L9 meta-injection toolkit for classifying, extracting, normalizing, injecting, verifying, and indexing metadata for L9 prompt, skill, kernel, and repository artifacts.

## Package

- npm package: `l9-meta-injector`
- version: `2.1.0`
- runtime entrypoint: `dist/index.js`
- type entrypoint: `dist/index.d.ts`
- full orchestration entrypoint: `runPipelineAsync`

## Architecture authority

The TypeScript package is the sole active runtime authority.

- Machine-readable authority: `docs/architecture-authority.json`
- Architecture: `docs/architecture.md`
- Contracts: `docs/contracts.md`
- Decisions: `docs/decision_log.md`
- Public API policy: `docs/public-api.md`
- Traceability: `docs/traceability-map.json`
- Repository manifest: `docs/manifest.md`

The earlier Python consolidation engine and its documents are retained only under `tools/consolidation/` and `docs/legacy/consolidation-v1/`.

## Pipeline

```text
classify -> extract -> assist -> inject -> verify -> index
```

## Install

```bash
npm install
```

## Validate

```bash
npm run build
npm run typecheck
npm test
npm run selfpack
npm run check:authority
npm run check:manifest
npm pack --dry-run
```

Distribution parity and installed-tarball validation are scheduled separately under RAA-006.

## Programmatic usage

```ts
import { runPipelineAsync } from "l9-meta-injector";

await runPipelineAsync({
  root: "./skills",
  glob: "**/*.md",
  namespace: "l9",
  authority: "l9.doctrine.platform",
  nearDupThreshold: 0.9,
  hashPrefixLength: 16,
  outDir: ".out",
  indexDir: ".index",
  dryRun: true,
  verbose: true,
  llmEnabled: false,
  normalizeFilenames: false,
});
```

## Public API status

`runPipelineAsync` is the primary supported orchestration interface. The broad root barrel remains transitional until RAA-007 defines explicit stability tiers and subpath exports. See `docs/public-api.md`.

## Scope boundary

This repository owns metadata injection and its package contracts. It does not include or replace external graph-export adapter work.
