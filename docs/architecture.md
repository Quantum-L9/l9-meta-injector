# Architecture

**As-built package generation:** 3  
**Package version:** 3.0.0

## Authority

The TypeScript pipeline under `src/` is the sole active engine. `runPipelineAsync` owns the complete classify, extract, assist, inject, verify, report, placement, MetaV3, and indexing sequence. The Python consolidation engine under `tools/consolidation/` is historical reference material and is neither shipped nor CI-gated.

`docs/architecture-authority.json` is the machine-readable authority index. Authority-critical file identities are recorded in `docs/architecture-manifest.json`.

## Package boundary

The package exposes six code entrypoints:

```text
l9-meta-injector                  stable orchestration root
l9-meta-injector/inventory        stable standalone inventory
l9-meta-injector/schema           stable metadata contracts
l9-meta-injector/advanced         experimental composition primitives
l9-meta-injector/advanced/llm     experimental process-global adapter controls
l9-meta-injector/repository-model stable repository model packet egress
```

`docs/public-api-contract.json` defines exact runtime and declaration inventories. `package.json#exports` derives from that contract. Unlisted deep imports are denied.

## Runtime path

```text
[optional local-files archive expansion]
retrieval -> extraction -> classification -> normalization
          -> optional assist -> injection -> verification
          -> deduplication -> placement -> MetaV3 -> indexes
```

When `PipelineConfig.localFiles` is set (ADR-016), archive **materialization** runs before retrieval: `.zip` files become sibling `*.l9extracted/` trees plus `<zip>.l9meta.yaml` sidecars, then members follow the normal path. Default mode never extracts. This path mutates the source by design and is not the observation path; canonical local-source observation is read-only (ADR-036, below). Since ADR-036 it refuses to replace an extraction target without ownership evidence, and its dry run performs zero source mutation.

Inventory and pipeline apply a shared omit layer (ADR-017): built-in protect for `SKILL.md`, noise skips for bytecode/logs, optional `.l9metaignore` / `--omit`. Cursor-native skill edits go through `runSkillsPipelineAsync` only.

The stable root keeps callers on the full path. Low-level primitives remain available only through an explicitly experimental subpath whose caller obligations are documented.

## Repository model egress

`src/repository_model.ts` converts an inventory observation into an `l9.repository-model`
packet bundle for the `l9-constellation-topology` consumer (ADR-030).

```text
inventoryTree (dry run) -> evidence + diagnostics -> packet build
                        -> producer validation -> canonical bundle emission
```

The emitted bundle is `packet.json`, `receipts/validation-receipt.json`, and a hash-bound
`manifest.json`, each written as canonical JSON with a single trailing newline. Semantic
identity is reproducible, checkout-path independent, and derived from repository evidence
only: unsupported domains stay empty and are reported as diagnostics.

This repository holds no runtime dependency on topology. Conformance is proven by feeding
the committed golden bundle to the real consumer from an ephemeral read-only checkout
(`L9_TOPOLOGY_CHECKOUT=<checkout> npm run topology:conformance`); the bound revision and result are
recorded in `docs/topology-conformance.json`.

## Local-source acquisition

`src/local_source.ts` observes an arbitrary local source read-only (ADR-036). The
source may be a file, an ordinary directory, an external-drive tree, a synced folder,
or a ZIP archive; it does not have to be a Git repository.

```text
physical local source
  -> stable snapshot (enumerate -> stream hashes -> re-enumerate)
  -> archive staging in tool-owned scratch
  -> central-directory preflight + two-sided resource budget
  -> virtual members `<archive>!/<member>` + provenance graph
  -> InventoryResult -> deterministic interpretation -> l9.repository-model
```

Nothing under the observed root is written, renamed, or removed. Archives are staged
outside the source tree, so no sibling extraction directory and no adjacent archive
sidecar is created; recursive deletion is confined to a scratch root this session
created and can still prove it owns. A `*.l9extracted` directory is treated as
generated output only when an ownership marker and an adjacent archive agree, so a
user directory that merely shares the name is preserved.

`src/zip_reader.ts` reads the central directory and streams members through Node's
zlib under an explicit ceiling; no subprocess participates in the canonical security
boundary and no dependency was added. `src/archive_preflight.ts` judges every member —
path shape, entry type, encryption, compression method, exact duplicates, and case-
and Unicode-folded collisions — before any byte is written, and one violation holds
the whole archive rather than yielding a partial view. `src/local_archive_policy.ts`
bounds size, member count, expansion, ratio, depth, path length and time, checked
both against declared metadata and against the bytes actually produced.

Identity is `file:sha256:…`, `archive:sha256:…`, or `fs:sha256:…` over a canonical
manifest of repository-relative paths, entry kinds, content hashes and literal symlink
targets. Absolute paths, inodes, timestamps, scratch locations, usernames and
hostnames are excluded. If the source changes between the two enumerations, the
observation is unstable and no canonical packet is emitted.

Members reach the packet as ordinary artifacts at their virtual locator, plus a
`DERIVED_FROM` relationship to their archive carrying the archive digest, member path,
nesting depth and member identity. Nested archives preserve the whole chain. Symlinks
are recorded but never traversed; devices, sockets and FIFOs are recorded rather than
disappearing. `src/encoding.ts` validates a whole file as UTF-8 in bounded memory
before any decode or mutation, so a known-text extension no longer grants eligibility
on its own.

Trust boundary and known limits: `docs/local-source-trust-boundary.md`.
Migration from `--local-files`: `docs/migrations/local-files-to-local-source.md`.

## Distribution

Source compiles to committed `dist/`. `check:dist` rebuilds in isolation and compares every JavaScript file, declaration, and source map. It rejects missing, extra, changed, untracked, or symlinked distribution files.

`test:packed` creates the npm tarball, enforces the package contract, installs it in a clean consumer, executes every supported runtime entrypoint, compiles every declaration entrypoint, and confirms deep imports fail.

## CI/CD architecture

The repository has four active workflows:

| Workflow | Jobs | Events | Role |
|---|---|---|---|
| `CI` | `smoke` | Pull requests; push to `main` | Canonical aggregate validation and clean-checkout proof |
| `L9 Lint and Test (Node)` | `ESLint`, `tsc --noEmit`, `Vitest` | Pull requests; push to `main`; manual | Independent first-party Node/TypeScript checks |
| `L9 Analysis` | `Analyze (semgrep -> SDK)`, `Publish analysis (Core)` | Pull requests; manual | Governed Semgrep capture, normalization, canonical bundle validation, and check publication |
| `L9 Supply Chain` | `OpenSSF Scorecard`, `SBOM` | Scorecard on push to `main`; SBOM on pull request and push | Reusable supply-chain evidence from pinned L9 Core workflows |

No workflow job uses `continue-on-error: true`.

The Semgrep provider command intentionally uses `|| true` only at raw report production. This preserves provider output for SDK normalization and policy evaluation; it does not make normalized findings advisory by itself.

Workflow presence does not prove branch-protection required contexts. Required-check settings are external repository configuration and must be inspected separately.

## Lint and type boundaries

The flat ESLint configuration targets `src/**/*.ts` and `tests/**/*.ts`. It excludes `dist`, dependencies, coverage, fixtures, examples, scripts, and JavaScript-family files. The current ruleset establishes the lint surface and treats unused variables as warnings, except names intentionally prefixed with `_`.

The TypeScript build is strict, enables `noUnusedLocals` and `noImplicitReturns`, and compiles `src/**/*`. Vitest owns test execution.

No repository pre-commit framework is configured at this revision.

## Architecture decisions

`docs/decision_log.md` indexes the active decision sequence. Full context, alternatives, rationale, and consequences live under `docs/decisions/`. ADRs preserve human-readable decision history; `docs/architecture-authority.json`, package contracts, and executable validators remain the machine enforcement authority.

Accepted ADRs are never deleted. A replacement uses the next number and links to the superseded record.

## Validation

```bash
npm ci
npm run lint
npm run validate
git status --porcelain --untracked-files=all
```

The canonical aggregate command checks source types, Vitest, the exact API contract, architecture authority, deterministic architecture manifest, committed distribution parity, selfpack, and installed-tarball consumption. ESLint is an additive independent gate. Validation must leave the checkout clean.

Any change to this document requires:

```bash
npm run manifest:update
npm run validate
```

## Publication boundary

`npm publish` is separately fail-closed through `check:publication`. Successful implementation, packaging, and CI do not authorize publication. Registry history, constellation-consumer inventory, and distribution-owner approval must be recorded before the publication decision can become `approved`.
