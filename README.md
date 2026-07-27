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
import { runPipelineAsync } from "l9-meta-injector";
import { inventoryTree } from "l9-meta-injector/inventory";
import { buildMetaV3 } from "l9-meta-injector/schema";
import { compilePlacementPlans } from "l9-meta-injector/advanced";
import { makeOpenAIAdapter } from "l9-meta-injector/advanced/llm";
```

The root is the stable orchestration boundary. `inventory` and `schema` are stable subpaths. `advanced` and `advanced/llm` are explicit experimental surfaces. Imports not listed in `package.json#exports` are unsupported and rejected.

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

| Input | Default | Notes |
|---|---|---|
| `mode` | `inventory` | `inventory` = read-only classify + manifest report. `pipeline` = full scan→inject→verify→index. |
| `root` | `.` | Directory to scan, relative to the calling repo's checkout. |
| `namespace` | *(repo name)* | `pipeline` mode only — stamped into placement/verification. |
| `dry-run` | `true` for `inventory`, `false` for `pipeline` | `pipeline` verification requires real injected frontmatter, so a `pipeline` dry-run will always fail verification on prose files — pair `dry-run: "true"` with `fail-on-issues: "false"` if you want a preview-only pipeline pass. |
| `fail-on-issues` | `true` | `pipeline` mode only — gate the job on `verification.passed`. |
| `upload-artifact` | `true` | Uploads the manifest/report directory as a workflow artifact. |

Outputs: `scanned`, `injected` (`pipeline` mode), `verification-passed` (`pipeline` mode: `true`/`false`/`n-a`).

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
