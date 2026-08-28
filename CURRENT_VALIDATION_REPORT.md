# Current validation report

**Generated at commit:** `3856f428ca6e2f04a0f14fde54b642d93befb79e`
**Working tree:** clean apart from this report
**Bound to tree:** `sha256:1cc5cfa3ba65437e9c25689711aae7d0a4c04a8ace8e8bb77c898bfa3b4ad867`
**Generated:** 2026-08-28T18:07:53.214Z

This report is written by `scripts/validation-report.js`, which runs each
command below and records the exit code it received rather than a claim about it.

It is bound to the **tree digest**, not to the commit id: a digest over every
tracked file's mode, blob hash and path, plus the working-tree status, with this
report itself excluded from both. Committing the report therefore does not
invalidate it, and changing one byte of anything else does.
`npm run validate:report -- --check` recomputes the digest and fails when it has
moved, so a report written against an earlier tree cannot be presented as
evidence for this one. The commit above is recorded because a reader wants to
know where the run happened; it is not what the check compares.

## Commands

| Command | Exit | Result | Covers |
|---|---:|---|---|
| `npm run lint` | 0 | pass | ESLint over src and tests |
| `npm run validate` | 0 | pass | the aggregate gate |

## Verdict

**green**

Every command above exited zero on the tree named at the top of this file.

## What this report does not say

- It is not a publication authorization. `npm run check:publication` is a
  separate gate and remains fail-closed on its own evidence.
- It is not a statement about any other commit. Re-run it on the tree you mean
  to make a claim about.
- `[l9-meta-injector] verification FAILED for 1/1 file(s)` lines inside the
  Vitest output are fail-closed negative-path fixtures asserting their own
  refusal, not failures; the exit codes in the table are the authority.
