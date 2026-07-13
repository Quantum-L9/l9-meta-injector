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

## Claude Code skills & agents

Installed and active for Claude Code sessions in this repo (see [`.claude/README.md`](.claude/README.md)):

- **Skill** `l9-pr-remediation` (`.claude/skills/l9-pr-remediation/`) — recursive PR remediation loop: CI failures + review-bot comments → batched fix → local verify → one push per cycle → reply/resolve threads → converge.
- **Agent** `pr-review-resolver` (`.claude/agents/pr-review-resolver.md`) — autonomous PR review-comment resolver; validates each suggestion and pushes focused commits. Original prompt bundle preserved under `docs/agents/pr-review-resolver/`.

## Scope boundary

This repository is meta injection only. It does not include or replace external graph export adapter work.

## Build Plan

The current GMP-chunked upgrade plan and operator-approved execution order are embedded at [`docs/build_plan.md`](docs/build_plan.md). Execute chunks locally through GMP with one validation-backed commit per chunk; do not push unless explicitly authorized.

## Coding Agent Handoff

This pack includes a GMP v2.0 coding-agent handoff under `docs/coding_agent_handoff/`.
Start with `docs/coding_agent_handoff/CODING_AGENT_HANDOFF.md`, then execute one GMP chunk at a time from `docs/build_plan.md`.

Recommended first chunk: **GMP-001: Add `npm run validate`**.

