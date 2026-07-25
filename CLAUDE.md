# l9-meta-injector — agent guide

TypeScript metadata-injection toolkit. Source lives under `src/`, tests under `tests/`, and compiled output is committed under `dist/`. The TypeScript pipeline is the sole active engine. `tools/consolidation/` is historical reference material, not a second runtime.

## Source of truth

1. Repository files and executable validators
2. `docs/architecture-authority.json`
3. `docs/public-api-contract.json` and `docs/package-contract.json`
4. `docs/decision_log.md` and accepted ADRs under `docs/decisions/`
5. `AGENTS.md`, `INVARIANTS.md`, and `docs/architecture.md`
6. Unknown, never guessed

## Architecture decisions

Significant architecture, API, CI, distribution, or publication-policy changes require a sequential ADR under `docs/decisions/`. Preserve accepted ADRs and supersede them with forward and backward links rather than deleting or rewriting history.

## Verify before pushing

Run the complete local gate:

```bash
npm ci
npm run lint
npm run validate
git status --porcelain --untracked-files=all
```

The final command must produce no output.

`npm run validate` is the canonical aggregate gate. It runs source type checking, Vitest, public API validation, architecture-authority validation, deterministic architecture-manifest validation, committed `dist/` parity, selfpack, and clean installed-tarball consumer proof. ESLint is separate and must also pass.

After changing `docs/architecture.md` or another authority-critical file:

```bash
npm run manifest:update
npm run validate
```

After changing `src/`, keep `dist/` in the same commit. Do not hand-edit generated output as the source of truth.

## CI topology

- `CI / smoke`: pull requests and pushes to `main`; runs `npm ci`, `npm run validate`, then proves the checkout stayed clean.
- `L9 Lint and Test (Node) / ESLint`: pull requests, pushes to `main`, and manual dispatch.
- `L9 Lint and Test (Node) / tsc --noEmit`: strict source type checking.
- `L9 Lint and Test (Node) / Vitest`: one-shot tests with `CI=true`.
- `L9 Analysis`: pull requests and manual dispatch; resolves governance, captures Semgrep output, normalizes and validates the bundle, then publishes the governed result.
- `L9 Supply Chain / SBOM`: pull requests and pushes to `main`.
- `L9 Supply Chain / OpenSSF Scorecard`: pushes to `main` only.

The raw Semgrep command uses `|| true` so provider output can be normalized. This does not waive findings. No workflow job uses `continue-on-error: true`.

Required branch-protection contexts are repository settings outside the tree. Verify them; do not infer them from workflow presence.

## Lint and type boundaries

ESLint covers `src/**/*.ts` and `tests/**/*.ts`. It intentionally ignores generated output, dependencies, coverage, fixtures, examples, scripts, and JavaScript-family files. `@typescript-eslint/no-unused-vars` is warning-level and ignores names beginning `_`.

`tsconfig.json` is strict and enables `noUnusedLocals` and `noImplicitReturns`; the declaration build includes `src/**/*`.

No repository pre-commit framework is configured. CI commands are the authority.

## Always

- Preserve body content and idempotency.
- Keep runtime exports, declarations, public API contracts, and package exports synchronized.
- Rebuild `dist/` after source changes.
- Regenerate the architecture manifest after authority-critical changes.
- Keep GitHub actions and reusable workflows pinned to immutable commit SHAs.
- Treat unknown external evidence and settings as unknown.
- Keep `docs/decision_log.md` and `docs/decisions/` aligned when an architecture decision changes.

## Never

- Introduce a second active engine or authority corpus.
- expose unsupported deep imports.
- bypass `check:publication`.
- mark publication evidence verified without external proof.
- claim ignored ESLint paths were linted.
- interpret a green pack as authorization to publish.
- delete an accepted ADR or reuse an ADR number.

## Operating mode: autonomous

- Default to action on reversible work: create or rebase branches, open pull requests, merge your own green work, and update reports or documentation.
- Stop for irreversible or destructive actions, publication, credential changes, force-pushing over another person's work, or genuinely ambiguous high-impact choices.
- On low-risk forks, choose the sane default, state the assumption, and proceed.

## Publication

`prepublishOnly` runs `npm run validate` and `npm run check:publication`. Publication remains fail-closed until registry history, constellation consumers, and distribution-owner approval are resolved in `docs/package-publication-decision.json`.
