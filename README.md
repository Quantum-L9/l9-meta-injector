# l9-meta-injector

L9 metadata injection for classifying, normalizing, injecting, verifying, inventorying, and indexing prompt, skill, kernel, source, and repository artifacts.

## Package identity

- Package: `l9-meta-injector`
- API generation: 3
- Runtime authority: TypeScript under `src/`
- Distribution: committed `dist/`, proven by `npm run check:dist`
- Package proof: installed tarball tested by `npm run test:packed`

## Supported imports

```ts
import { runPipelineAsync, runSkillsPipelineAsync } from "l9-meta-injector";
import { inventoryTree } from "l9-meta-injector/inventory";
import { buildMetaV3 } from "l9-meta-injector/schema";
import { compilePlacementPlans } from "l9-meta-injector/advanced";
import { makeOpenAIAdapter } from "l9-meta-injector/advanced/llm";
```

The root is the stable orchestration boundary. `inventory` and `schema` are stable subpaths. `advanced` and `advanced/llm` are explicit experimental surfaces. Imports not listed in `package.json#exports` are unsupported and rejected.

**SKILL.md protection:** `inventory` and `pipeline` modes never mutate `SKILL.md` / `skill.md` (built-in omit). Use `runSkillsPipelineAsync` / `npm run skills` / Action `mode: skills` for Cursor-native description improvements (ADR-017).

**Omit:** built-in noise + SKILL.md protect, optional `.l9metaignore`, CLI `--omit` / `--omit-file`.

## GitHub Action

Publication to npm is currently blocked (see `check:publication` below), but this package is fully
consumable as a **GitHub composite action** — it runs directly against the pinned ref's committed
`dist/`, no build step and no npm registry needed. Drop this into any repo's workflow:

```yaml
# Read-only preview: classify + write an inventory manifest as a build artifact.
# Never mutates the checked-out repo. Safe as a first drop-in.
- uses: actions/checkout@v4
- uses: Quantum-L9/l9-meta-injector@main
  with:
    mode: inventory
```

```yaml
# Real CI gate: inject + verify metadata, fail the job on verification drift
# (e.g. sharing_scope mismatches against the given namespace).
- uses: actions/checkout@v4
- uses: Quantum-L9/l9-meta-injector@main
  with:
    mode: pipeline
    namespace: my-repo
    fail-on-issues: "true"
```

```yaml
# Cursor-native skills mode: material-improve SKILL.md description (Use when …).
- uses: actions/checkout@v4
- uses: Quantum-L9/l9-meta-injector@main
  with:
    mode: skills
    llm: "true"
    llm-base-url: "https://api.openai.com/v1"
    llm-model: "gpt-5-nano"
    llm-api-key: ${{ secrets.OPENAI_API_KEY }}
```

```yaml
# Pipeline mode with LLM-assisted semantic classification. Composite actions cannot
# read the secrets context directly, so the calling workflow passes its own secret in
# as an input — never hardcode a key in `with:`.
- uses: actions/checkout@v4
- uses: Quantum-L9/l9-meta-injector@main
  with:
    mode: pipeline
    namespace: my-repo
    llm: "true"
    llm-base-url: "https://api.openai.com/v1"
    llm-model: "gpt-5-nano" # cheapest OpenAI model as of 2026-07; ~$0.0001-0.0003/file, see TODO.md
    llm-api-key: ${{ secrets.OPENAI_API_KEY }}
```

| Input | Default | Notes |
|---|---|---|
| `mode` | `inventory` | `inventory` = classify + manifest. `pipeline` = scan→inject→verify→index. `skills` = Cursor-native skill description improve. |
| `root` | `.` | Directory to scan, relative to the calling repo's checkout. |
| `namespace` | *(repo name)* | `pipeline` mode only — stamped into placement/verification. |
| `dry-run` | `true` for `inventory`, `false` for `pipeline`/`skills` | `pipeline` verification requires real injected frontmatter, so a `pipeline` dry-run will always fail verification on prose files — pair `dry-run: "true"` with `fail-on-issues: "false"` if you want a preview-only pipeline pass. |
| `fail-on-issues` | `true` | `pipeline` mode only — gate the job on `verification.passed`. |
| `omit` | *(empty)* | Comma-separated gitignore-style patterns (built-ins always protect `SKILL.md` and skip bytecode/logs). |
| `upload-artifact` | `true` | Uploads the manifest/report directory as a workflow artifact. |
| `llm` | `false` | `pipeline`/`skills` — enable LLM-assisted field assist (falls back to local/no-op if `llm-base-url`/`llm-model`/`llm-api-key` are incomplete). |
| `llm-base-url` | *(none)* | OpenAI-chat-completions-compatible endpoint. |
| `llm-model` | *(none)* | Model name sent in the request body. |
| `llm-api-key` | *(none)* | Pass from the calling workflow's own secret, e.g. `${{ secrets.OPENAI_API_KEY }}`. Never hardcoded; read via env, never placed on the command line. |
| `llm-allow-insecure` | `false` | Allow a non-https `llm-base-url` (e.g. a self-hosted runner reaching a local model). |

Local CLI (not the GitHub Action): `npm run pipeline -- <root> --local-files` expands `.zip` archives into sibling `*.l9extracted/` dirs, writes `<zip>.l9meta.yaml` sidecars, and injects extracted members (ADR-016). Default pipeline mode still skips archives. Requires system `unzip`.

`npm run skills -- <root> --llm …` runs Cursor-native skill mode (ADR-017).

Outputs: `scanned`, `injected` (`pipeline`/`skills`), `verification-passed` (`pipeline` mode: `true`/`false`/`n-a`).

## Validation

```bash
npm ci
npm run validate
```

The canonical gate covers typing, tests, the exact API contract, architecture authority, deterministic manifest, committed distribution parity, selfpack, and an installed-tarball consumer.

`prepack` enforces package integrity. `prepublishOnly` additionally runs `check:publication`; publication remains blocked until the external distribution history and constellation-consumer inventory are resolved in `docs/package-publication-decision.json`.

## Architecture and contracts

- `docs/architecture-authority.json`
- `docs/public-api-contract.json`
- `docs/public-api.md`
- `docs/package-contract.json`
- `docs/contracts.md`
- `docs/traceability-map.json`

The historical Python consolidation engine remains reference-only under `tools/consolidation/` and `docs/legacy/consolidation-v1/`.
