# Current validation report

**Generated at commit:** `19cbeb07e45cbd9c3c07f478e414c63547086193`
**Working tree:** clean apart from this report
**Bound to tree:** `sha256:66505a107d8af5d8b0f00dc6727772f09a5f2aaae0bb3c5d796a0c68e288611c`
**Generated:** 2026-09-03T00:41:49.757Z

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
