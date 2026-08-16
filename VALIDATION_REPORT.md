# VALIDATION REPORT

Generated: 2026-08-13T00:00:00Z

## Scope

Deploy preflight for `l9-meta-injector@4.0.0`, plus remediation of the
dev-toolchain advisories surfaced by the preflight. No runtime source changed;
the only tree changes are the `package-lock.json` transitive resolutions, the
resulting `docs/architecture-manifest.json` blob-sha refresh, and this report.

## Commands

| Command | Exit | Result |
|---|---:|---|
| `npm ci` | 0 | pass |
| `npm run lint` | 0 | pass — ESLint clean |
| `npm run validate` | 0 | pass — full aggregate gate |
| `npm run typecheck` (via validate) | 0 | pass — `tsc --noEmit` strict |
| `npm test` (via validate) | 0 | pass — 61 suites / 528 tests |
| `npm run check:api` | 0 | pass — 5 explicit entrypoints |
| `npm run check:authority` | 0 | pass |
| `npm run check:manifest` | 0 | pass — deterministic manifest in sync |
| `npm run check:dist` | 0 | pass — 129 files, isolated build byte-identical |
| `npm run selfpack` | 0 | pass — 15/15 verified clean, idempotent |
| `npm run test:packed` | 0 | pass — installed tarball, 5 entrypoints |
| `npm run check:release-candidate` | 0 | pass — 4.0.0 identity coherent → tag `v4.0.0` |
| `npm audit --audit-level=moderate` | 0 | pass — 0 vulnerabilities |
| `git status --porcelain --untracked-files=all` | 0 | clean after gate (byte-reproducible) |

## Notes

- Runtime `dependencies` is empty; consumers inherit no transitive runtime risk.
- The prior four advisories (`js-yaml`, `nanoid`, `postcss`, `brace-expansion`)
  were all dev-toolchain transitives (eslint / vitest → vite → postcss). They
  were resolved by `npm audit fix` (no `--force`); no direct devDependency
  declaration in `package.json` changed.
- `docs/architecture-manifest.json` tracks the `package-lock.json` git blob
  sha1, so it was regenerated with `npm run manifest:update` after the lock
  change, per the authority-critical-change workflow.
- The `[l9-meta-injector] verification FAILED for 1/1 file(s)` lines in Vitest
  output are expected fail-closed negative-path fixtures; the suite exits 0.

## Verdict

Code / build / test gate: **green**. Ready for GitHub commit/tag consumption
after the repository's own release authorization.

## Publication status

`npm publish` remains **fail-closed** by design. `npm run check:publication`
reports `BLOCKED` (`docs/package-publication-decision.json` =
`blocked_pending_history_check`) with five unresolved external-evidence items.
This gate must not be bypassed; resolve each evidence item with external proof
before publishing.

## Next Action

Cut and validate the `v4.0.0` release tag on the final immutable commit, then
resolve the publication-evidence items tracked as issues.
