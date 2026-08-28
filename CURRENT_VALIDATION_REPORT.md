# Current validation report

**Generated at commit:** `2fd40b8abbc64284a948702cd208274a22eeb3c1`
**Working tree:** clean apart from this report
**Bound to tree:** `sha256:0ebc85e243dfab1735dc2499734c1cd5f90a67e8f98be40545de6a9accae2bb7`
**Generated:** 2026-08-28T18:36:53.681Z

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
