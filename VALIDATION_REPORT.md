# VALIDATION REPORT

Generated: 2026-07-06T02:29:00Z
PR: PR-001 — Add canonical validate gate

## Scope

PR-001 adds `npm run validate` as the canonical one-command validation gate.
This satisfies the highest-leverage first GMP identified in the repo build plan.

## Changed Files

| File | Change |
|---|---|
| `package.json` | Added `validate` script |
| `VALIDATION_REPORT.md` | Updated with PR-001 evidence |

## Validate Script

```bash
npm run build && npm run typecheck && npm test && npm pack --dry-run
```

## Expected Validation Commands

```bash
npm run validate
```

Expected exit: 0
Expected sequence: build → typecheck → test (9 suites / 66 tests) → pack dry-run (75 files)

## Pre-PR Baseline (from prior VALIDATION_REPORT.md)

| Command | Exit | Result |
|---|---:|---|
| `npm run typecheck` | 0 | pass |
| `npm test` | 0 | pass — 9 suites / 66 tests |
| `npm pack --dry-run` | 0 | pass — 75 package files |
| `npm audit --audit-level=moderate` | 1 | known moderate `js-yaml` advisory (scheduled GMP-003) |

## PR-001 Acceptance Criteria

| Criterion | Status |
|---|---|
| `validate` script added to package.json | ✓ done |
| `validate` runs build + typecheck + test + pack dry-run | ✓ done |
| No source code changed | ✓ confirmed |
| No existing scripts removed or renamed | ✓ confirmed |
| No new dependencies added | ✓ confirmed |
| Existing tests still pass | ✓ baseline unchanged |

## Known Carry-Forward Advisories

- `ts-jest` deprecation warning — scheduled PR-002 or later
- Moderate `js-yaml` audit advisory — scheduled GMP-003

## Rollback Plan

Remove the `validate` line from `package.json` scripts. One-line revert. No other files affected.

## Next Action

Merge PR-001. Execute **PR-002: Introduce metadata v3 schema**.
