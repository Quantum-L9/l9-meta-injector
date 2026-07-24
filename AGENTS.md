# l9-meta-injector Agent Guide

## Repository identity

- Package: `l9-meta-injector@3.0.0`
- Runtime authority: TypeScript under `src/`
- Compiled distribution: committed `dist/`
- Supported Node version: `>=18`; primary CI smoke uses Node 20
- Historical reference implementation: `tools/consolidation/` and `docs/legacy/consolidation-v1/`
- Canonical validation command: `npm run validate`
- Publication gate: `npm run check:publication`

The TypeScript pipeline is the sole active engine. Do not treat the historical Python consolidation implementation as a runtime authority or a second supported product surface.

## Supported package surfaces

| Import | Stability | Purpose |
|---|---|---|
| `l9-meta-injector` | Stable | Full orchestration through `runPipelineAsync` |
| `l9-meta-injector/inventory` | Stable | Standalone inventory |
| `l9-meta-injector/schema` | Stable | Metadata contracts |
| `l9-meta-injector/advanced` | Experimental | Low-level composition primitives |
| `l9-meta-injector/advanced/llm` | Experimental | LLM adapter controls |

Unlisted deep imports are unsupported and must remain rejected by `package.json#exports`.

## Architecture decision records

Accepted architecture decisions live under `docs/decisions/` and are indexed by `docs/decision_log.md`. ADRs explain rationale and trade-offs; machine-readable contracts and executable validators remain the enforcement authority.

- Do not delete accepted ADRs. Supersede them with a new sequential ADR and link both directions.
- Record a new ADR when a change is hard to reverse, crosses subsystem boundaries, or changes package, CI, authority, distribution, or publication policy.
- Preserve the active numbering sequence. Decisions 1 through 9 are historical; active TypeScript decisions begin at ADR-010.

## Required local gate

Run from a clean checkout:

```bash
npm ci
npm run lint
npm run validate
git status --porcelain --untracked-files=all
```

The final command must produce no output. `npm run validate` covers type checking, Vitest, public API, architecture authority, deterministic architecture manifest, committed distribution parity, selfpack, and installed-tarball consumption. ESLint is a separate required command and separate CI context.

When `docs/architecture.md` or another authority-critical file changes, run this before validation:

```bash
npm run manifest:update
```

## CI pipeline

Workflow-level blocking means the job has no `continue-on-error`. Whether a context is required by branch protection is an external repository setting and must be verified separately.

### Blocking or fail-closed jobs

| Workflow | Job/context | Events | Enforcement |
|---|---|---|---|
| `CI` | `smoke` | Pull requests; push to `main` | `npm ci`, `npm run validate`, then clean-checkout proof |
| `L9 Lint and Test (Node)` | `ESLint` | Pull requests; push to `main`; manual | First-party TypeScript lint surface |
| `L9 Lint and Test (Node)` | `tsc --noEmit` | Pull requests; push to `main`; manual | Strict source type checking |
| `L9 Lint and Test (Node)` | `Vitest` | Pull requests; push to `main`; manual | One-shot test execution with `CI=true` |
| `L9 Analysis` | `Analyze (semgrep -> SDK)` | Pull requests; manual | Governance resolution, Semgrep report normalization, canonical bundle validation, artifact production |
| `L9 Analysis` | `Publish analysis (Core)` | When analysis is enabled | Publishes the governed analysis result/check |
| `L9 Supply Chain` | `SBOM` | Pull requests; push to `main` | Reusable L9 SBOM workflow |
| `L9 Supply Chain` | `OpenSSF Scorecard` | Push to `main` only | Reusable L9 Scorecard workflow |

### Conditional or intentionally non-fatal steps

| Location | Behavior | Correct interpretation |
|---|---|---|
| `l9-analysis.yml` Semgrep invocation | Raw `semgrep scan` ends with `|| true` | Preserve provider output even when findings exist; downstream SDK normalization and governed publication determine the result. It is not a blanket finding waiver. |
| `l9-analysis.yml` jobs | Analysis runs only for pull requests and manual dispatch | No push-to-main analysis job is defined in this workflow. |
| `l9-supply-chain.yml` Scorecard | `if: github.event_name == 'push'` | Scorecard publication is deliberately default-branch-only. |

No workflow currently uses `continue-on-error: true`.

## Pre-commit

No `.pre-commit-config.yaml` or equivalent repository pre-commit framework is present at the audited revision. Local hooks are not a substitute for the commands above.

## Lint and type boundaries

### ESLint

ESLint is intentionally scoped to:

- `src/**/*.ts`
- `tests/**/*.ts`

The flat config ignores:

- `dist/**`
- `node_modules/**`
- `coverage/**`
- `fixtures/**`
- `examples/**`
- `scripts/**`
- JavaScript, CommonJS, and ESM files

`@typescript-eslint/no-unused-vars` is currently warning-level, with names beginning `_` intentionally ignored. Do not claim ignored paths were linted.

### TypeScript

`tsconfig.json` enables `strict`, `noUnusedLocals`, and `noImplicitReturns`. The canonical typecheck includes `src/**/*`; test behavior is exercised by Vitest rather than the source declaration build.

## Change rules

### Always

- Rebuild committed `dist/` after changing `src/`.
- Keep runtime exports, declarations, `package.json#exports`, and `docs/public-api-contract.json` aligned.
- Run `npm run manifest:update` after changing an authority-critical file.
- Use `npm run selfpack:update` only when a fixture-output change is intentional and reviewed.
- Preserve body content, idempotency, taxonomy validity, and deterministic outputs.
- Keep external actions and reusable workflows pinned to immutable commits.
- Add or supersede an ADR for significant architecture, API, CI, distribution, or publication-policy changes.

### Never

- Edit generated `dist/` as the source of truth.
- expose an unlisted deep import.
- treat `tools/consolidation/` as an active engine.
- bypass `check:publication` or change publication evidence from `unknown` without external proof.
- interpret Semgrep's raw `|| true` as permission to ignore normalized findings.
- claim a check is branch-protection-required without verifying repository settings.
- delete or rewrite accepted ADR history; supersede it explicitly.

## Known intentional exclusions

| Exclusion | Location | Reason |
|---|---|---|
| Git SHA-1 for architecture entries | `scripts/lib/architecture-authority.js` | Reproduces Git blob object identity for drift detection, not cryptographic security. |
| Generated and non-TypeScript areas excluded from ESLint | `eslint.config.js` | Initial first-party TypeScript lint boundary; excluded files need their own validator if they become policy-critical. |
| Historical Python engine excluded from active runtime | `docs/architecture-authority.json` | Retained only for traceability and reference. |
| Raw Semgrep process exit absorbed | `.github/workflows/l9-analysis.yml` | Allows canonical normalization and policy evaluation to own the final outcome. |

## Publication

Green CI proves implementation and packaging, not authorization to publish. Publication remains blocked until registry history, consumer inventory, and distribution-owner approval are recorded as verified or not-applicable-with-reason in `docs/package-publication-decision.json`.
