# Validation Report

**Generated:** 2026-07-04  
**Scope:** build plan inclusion + recursive optimization report, docs-only mutation  
**Push performed:** no

## Commands Run

| Command | Exit | Result |
|---|---:|---|
| `npm run typecheck` | 0 | pass |
| `npm test` | 0 | pass — 9 suites, 66 tests |
| `npm pack --dry-run` | 0 | pass — 75 npm package files, 52.4 kB package |
| `npm audit --audit-level=moderate` | 1 | known advisory — `js-yaml <3.15.0`, scheduled as GMP-003 |

## Notes

- The new build-plan artifact is repo-local documentation and is intentionally excluded from `npm pack` by `.npmignore` because `docs/` is excluded from the published package.
- Test output still includes the known ts-jest deprecation warning; it is scheduled as GMP-002.
- No source files were changed in this pass.
- No push was performed.

## Verdict

Local repo pack is clean and commit-ready with documented advisories. The audit advisory is not introduced by this docs-only change and remains part of the planned GMP sequence.
