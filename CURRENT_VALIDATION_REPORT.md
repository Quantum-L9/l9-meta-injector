# Current validation report

**Generated at commit:** `bae81e7a85f16d50c52b1fdc6173777ce581dca1`
**Working tree:** **dirty** — this report describes uncommitted changes
**Bound to tree:** `sha256:121be83af41364898330c0f9057de0ef16e5e9cd86d6cdde5055809d2ce28a37`
**Generated:** 2026-09-01T19:26:33.837Z

This report is written by `scripts/validation-report.js`, which runs each
command below and records the exit code it received rather than a claim about it.

It is bound to the **tree digest**, not to the commit id: a digest over the
actual bytes of every tracked and untracked file, with this report itself
excluded. Committing the report therefore does not invalidate it, and changing
one byte of anything else does — including a second edit of a file that was
already dirty.
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
