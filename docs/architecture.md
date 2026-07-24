# Architecture

**As-built package generation:** 3  
**Package version:** 3.0.0

## Authority

The TypeScript pipeline under `src/` is the sole active engine. `runPipelineAsync` owns the complete classify, extract, assist, inject, verify, report, placement, MetaV3, and indexing sequence. The Python consolidation engine under `tools/consolidation/` is historical reference material and is neither shipped nor CI-gated.

`docs/architecture-authority.json` is the machine-readable authority index. Authority-critical file identities are recorded in `docs/architecture-manifest.json`.

## Package boundary

Version 3 exposes five code entrypoints:

```text
l9-meta-injector                stable orchestration root
l9-meta-injector/inventory      stable standalone inventory
l9-meta-injector/schema         stable metadata contracts
l9-meta-injector/advanced       experimental composition primitives
l9-meta-injector/advanced/llm   experimental process-global adapter controls
```

`docs/public-api-contract.json` defines exact runtime and declaration inventories. `package.json#exports` derives from that contract. Unlisted deep imports are denied.

## Runtime path

```text
retrieval -> extraction -> classification -> normalization
          -> optional assist -> injection -> verification
          -> deduplication -> placement -> MetaV3 -> indexes
```

The stable root keeps callers on the full path. Low-level primitives remain available only through an explicitly experimental subpath whose caller obligations are documented.

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
