# Output placement contract

Single source of truth for **where every l9-meta-injector entrypoint writes**.

Two entrypoint families exist, and they deliberately use **different** defaults. The
difference is intentional and is stated here so neither default has to be inferred from
code, and so neither is presented as one shared default.

Executable authority for this document:

- `scripts/lib/operation-dispatch.js` — dispatcher and direct-CLI resolution
- `docs/architecture-authority.json` → `invocation_boundary.output_placement`
- `tests/output_placement_contract.test.ts` — fails if code and this document diverge

## The two contexts

### 1. Governed Action / dispatcher context

`action.yml` → `node scripts/operation-cli.js --action-env`, resolved by
`normalizeEnvironment`.

| Input | Default | Placement |
|---|---|---|
| `L9_INPUT_OUT` | `.l9-meta-injector-out` | **inside** the target root |
| check report | `$RUNNER_TEMP/l9-meta-injector-check-<run>-<action>/check-report.json` | outside the target root |

**Why the default is inside the target root.** The composite Action uploads exactly one
path — `steps.run.outputs.artifact_path` — and an uploaded artifact path must live inside
`GITHUB_WORKSPACE`. Placing the default anywhere else would either break artifact upload
or require the Action to upload a path outside the workspace. `resolveFutureContainedPath`
therefore enforces `out ⊆ targetRoot` for this context, and that containment rule is a
security boundary, not a convenience default.

**Untracked output is expected here, and this is the documented reason.** The workspace is
an ephemeral CI checkout; `.l9-meta-injector-out` is a run artifact of that checkout, not a
repository contribution. Consumers that run the Action on a persistent working tree should
either ignore `.l9-meta-injector-out` or pass an explicit `out`.

The check report is the one exception: it is deliberately placed under `RUNNER_TEMP`, never
inside the target root, because `check` is a read-only gate and must not write into the
repository it is evaluating.

### 2. Direct / local CLI context

Invoked by an operator against a real working tree.

| Entrypoint | Option | Default | Placement |
|---|---|---|---|
| `scripts/operation-cli.js <mode> <root>` | `--out` | `.l9-meta-injector-out` | inside the target root |
| `scripts/inventory.js <root>` | `--out` | `<root>.l9inventory` | sibling of the target root |
| `scripts/apply-cli.js <root>` | `--out` | `<root>.l9out` | sibling of the target root |
| `scripts/check-cli.js <root>` | `--report` | `<tmpdir>/l9-meta-injector-check-<pid>.json` | outside the target root |
| `scripts/skills-cli.js <root>` | `--out` | `<root>.l9skills` | sibling of the target root |
| `scripts/local-source-cli.js <path>` | `--out` | `<tmpdir>/l9-local-source-out` | outside the observed source, always |

`scripts/operation-cli.js` is the governed dispatcher in both contexts, so it keeps one
resolution rule — `out ⊆ targetRoot` — whether it is driven by argv or by the Action
environment. The single-purpose CLIs below it are local tools with no artifact-upload
constraint, so they default outside the target root and leave the governed working tree
clean.

## What each mode actually writes

`out` being resolved is not the same as `out` being created. A resolved-but-unused `out`
directory is never created.

| Mode | Writes into `out` | Writes into the target repository |
|---|---|---|
| `inventory` | yes — `inventory.{json,csv,md}`, `inventory-duplicates.json` | no |
| `skills` | yes — skills pipeline outputs | only via governed inline patches |
| `check` | no (`persistOutputs: false`) | **never** — enforced by a before/after repository snapshot |
| `apply` | no (`persistOutputs: false`) | only `.l9/metadata-index.jsonl` and authorized inline patches, transactionally |
| `local-source` | yes — `bundle/`, `local-source-manifest.json`, `corpus-index.json`, `corpus-report.md` | **never** — the source is observed read-only, and each write is refused if its resolved path falls inside the observed tree |

So a governed `apply` on a clean working tree adds no untracked output directory at all.
The only path it writes outside authorized inline carriers is the canonical metadata index.

## Explicit `out` has the same semantics everywhere

When `out` is supplied explicitly:

- it must be a **relative** path (absolute values are rejected);
- it is resolved against the **target root**;
- it may not escape the target root, traverse a symlink out of it, or target Git internals;
- it may not be the target root itself.

These rules are identical for `L9_INPUT_OUT` and for `--out` on `scripts/operation-cli.js`.
The single-purpose CLIs accept an already-resolved path and do not re-apply containment;
they are local tools, not the governed boundary.

`scripts/local-source-cli.js` inverts the containment rule rather than dropping it. Its
subject is an arbitrary local source that must not be modified, so every output — the
packet bundle, the acquisition manifest, the corpus index and the corpus report — is
refused if its resolved path is the observed directory or lies inside it. An output
written beside the source would mutate what was just observed, and the next run would
then observe this run's output as if it were user content.

## local-files materialization (ADR-045)

`PipelineConfig.localFiles` extraction is not a CLI entrypoint, but it does write
into the target repository, so its placement is stated here:

- The final extraction directory is the archive's sibling `<stem>.l9extracted`, as
  before. What changed is the mechanism: members are written into
  `<stem>.l9extracted.candidate-<hex>` first, and the candidate is renamed into
  place; on a refresh, the previous directory is moved aside to
  `<stem>.l9extracted.previous-<hex>` and removed only after the swap succeeded.
- Both auxiliary names are transient. A failed materialization removes its
  candidate and leaves the previous extraction in place; a completed one leaves
  neither.

## Rules

- Do not change a default in code without changing this document in the same commit.
- Do not weaken `out` containment to make two contexts agree. The contexts are allowed to
  differ; the containment rule is not negotiable.
- Do not describe the two defaults as one shared default.
