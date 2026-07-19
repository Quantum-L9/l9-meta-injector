# tools/consolidation — secondary engine (reference only)

> **Status: out of scope for the shipped package.** This Python consolidation tool is
> **not** the authoritative metadata-injection engine. The authoritative engine is the
> TypeScript pipeline in `src/` (shipped as `dist/`, `package.json` → `main`). See the
> [Engine authority](../../docs/architecture.md#engine-authority) decision (ACA-001,
> `decision_log.md` #10).

## What this is

An earlier two-mode consolidation engine (repo-pack: in-place `L9_META` stamping;
folder-artifact: copy-only with `L9_ARTIFACT_META` or sidecar). It predates the
TypeScript pipeline and uses a **different header dialect** and a **different
`artifact_type` vocabulary** (`architecture│contract│node_spec│infra│template│skill│
unknown`).

## Why it is out of scope

| | This Python tool | Authoritative TS pipeline |
|---|---|---|
| Shipped in the npm package | No | Yes (`dist/`, `files` allowlist) |
| Run by CI (`ci.yml` → `smoke`) | No | Yes |
| Covered by tests / selfpack | No | Yes |
| Header dialect | `L9_META` / `L9_ARTIFACT_META` | `>>> l9:meta >>>` / frontmatter / sidecar |

Because it is wired into none of the package's build, test, or CI surfaces, it is not
maintained in lockstep with the TS engine and must not be treated as a source of truth.

## If you need consolidation behavior

Use the TypeScript pipeline (`runPipelineAsync` in `src/pipeline.ts`) — see
[`docs/architecture.md`](../../docs/architecture.md). New feature work and findings
remediation target the TS engine, not this tool. This directory is retained for
historical reference and is intentionally excluded from the taxonomy mapping in
`src/taxonomy.ts` (finding RAA-003): the TS package never reads its vocabulary.
