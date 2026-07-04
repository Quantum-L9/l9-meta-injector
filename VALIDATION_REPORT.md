# VALIDATION REPORT

Generated: 2026-07-04T16:23:00Z

## Scope

Validation after adding GMP v2.0 coding-agent handoff materials to the commit pack.

## Commands

| Command | Exit | Result |
|---|---:|---|
| `npm run typecheck` | 0 | pass |
| `npm test` | 0 | pass — 9 suites / 66 tests |
| `npm pack --dry-run` | 0 | pass — 75 package files, docs excluded by `.npmignore` |
| `npm audit --audit-level=moderate` | 1 | known moderate `js-yaml` advisory, scheduled as GMP-003 |

## Notes

- No source code changed.
- Added documentation/handoff files under `docs/coding_agent_handoff/`.
- `npm pack --dry-run` remains at 75 files because `.npmignore` excludes `docs/` from npm package payload.
- `ts-jest` deprecation warning remains scheduled for GMP-002.
- Moderate `js-yaml` audit advisory remains scheduled for GMP-003.

## Verdict

Commit-pack validation: **pass with known advisory**.

## Next Action

Execute **GMP-001: Add `npm run validate`** locally, then rerun typecheck, test, and npm pack dry-run.
