# Current validation report

<<<<<<< HEAD
**Generated at commit:** `e86f9bca677feec930b2b7046aa3f893dccc3558`
**Working tree:** clean apart from this report
**Bound to tree:** `sha256:c456be9340925f76d936297579bfdeebce13c10de76fc370a81983c7bcc82436`
**Generated:** 2026-11-07T18:27:24.701Z
=======
**Generated at commit:** `84d5055af11ed739efb485e2e1c8cb4e90f322dc`
**Working tree:** clean apart from this report
**Bound to tree:** `sha256:5dd733040aa141a3ff06951e3cc9971b67da766d05c53040d5036ebfc12ef814`
**Generated:** 2026-11-07T18:35:12.568Z
>>>>>>> origin/claude-mobile/dazzling-feynman-azm517

This report is written by `scripts/validation-report.js`, which runs each
command below and records the exit code it received rather than a claim about it.

It is bound to the **tree digest**, not to the commit id: a NUL-framed digest over
every tracked and untracked path's actual bytes/type and executable bit, with
this report itself excluded. Committing the report therefore does not invalidate
it, and changing one byte, executable mode, or unusual Git path changes the
digest — including a second edit of a file that was already dirty.
`npm run validate:report -- --check` recomputes the digest and also requires the
non-report tree to be clean, so stale evidence cannot be carried over a dirty
checkout.

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
- It is not a statement about any other tree. Re-run it on the tree you mean to
  make a claim about.
- `[l9-meta-injector] verification FAILED for 1/1 file(s)` lines inside the
  Vitest output are fail-closed negative-path fixtures asserting their own
  refusal, not failures; the exit codes in the table are the authority.
