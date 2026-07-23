# l9-meta-injector — agent guide

TypeScript metadata-injection toolkit. Source in `src/*.ts`, tests in `tests/*.test.ts`,
compiled output committed to `dist/` (rebuild with `npm run build` after any `src/` change).

## Verify before pushing
Run the full gate locally — it's what CI (`ci.yml` → `smoke`) runs:
```
npm ci && npm run build && npm run typecheck && npm test && node scripts/selfpack.js
```
`selfpack.js` is a snapshot smoke test over `./fixtures`; intended output changes are re-blessed
with `npm run selfpack -- --update`. Keep `dist/` in sync with `src/` in the same commit.

## Operating mode: autonomous
- Default to action. Do NOT ask for confirmation on reversible steps: create/rebase/push branches, open PRs, merge green PRs, close stale/superseded PRs, merge your own work, write reports/docs.
- Just do the obvious next step and report what you did — don't offer menus or ask "want me to…".
- Only stop to ask when an action is (a) irreversible/destructive (deleting data, force-pushing over someone else's commits, rotating secrets, publishing/impersonation), or (b) genuinely ambiguous with materially different, hard-to-undo outcomes.
- When you'd normally ask a clarifying question on a low-stakes fork, pick the sane default, state the assumption in one line, and proceed.

## CI
- `ci.yml` (`smoke`) is the single functional PR gate: build + typecheck + vitest + selfpack.
- `l9-supply-chain.yml` runs OpenSSF Scorecard (push to `main`) + SBOM (push + PR) via `l9-ci-core` reusable workflows.
- Copilot code review is driven by the org ruleset (run-on-push), not a workflow.
