# l9-meta-injector

L9 meta-injection toolkit for classifying, extracting, normalizing, injecting, verifying, and indexing metadata for L9 prompt/skill/kernel artifacts.

This package is the repo-ready consolidation of the uploaded `l9-meta-injection-pack-v2.1.0` artifact. It preserves the TypeScript source, compiled `dist/`, tests, schemas, examples, and consolidation documentation needed for the initial commit.

## Package

- npm package name: `l9-meta-injector`
- version: `2.1.0`
- main entrypoint: `dist/index.js`
- types entrypoint: `dist/index.d.ts`

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
npm test
npx jest --runInBand
npm pack --dry-run
```

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
  normalizeFilenames: false
});
```

## Namespace config example

See `examples/namespace.config.example.json`.

## Consolidation notes

The uploaded pack also included a consolidation skill/playbook. It is preserved under `docs/CONSOLIDATION_SKILL.md` and `tools/consolidation/` for traceability, but the npm package surface remains the TypeScript meta-injection toolkit.

## Scope boundary

This repository is meta injection only. It does not include or replace external graph export adapter work.
