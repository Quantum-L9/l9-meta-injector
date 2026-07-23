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
- Package contract: `docs/package-contract.json`
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
npm ci
npm run validate
```

The canonical gate includes type checking, Jest, architecture authority, deterministic manifest verification, isolated `src` to committed-`dist` parity, selfpack, and installed-tarball runtime and declaration tests.

Individual distribution checks are also available:

```bash
npm run check:dist
npm run test:packed
```

`prepack` refuses to create a tarball when authority, manifest, or committed `dist/` parity fails. `prepublishOnly` runs the complete validation gate.

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

The packed-consumer test proves that the current root package executes and its declarations compile. It does not convert every reachable low-level export into a stability promise. `runPipelineAsync` remains the primary supported orchestration interface; RAA-007 will define explicit runtime and declaration inventories and supported subpaths.

## Scope boundary

This repository owns metadata injection and its package contracts. It does not include or replace external graph-export adapter work.
