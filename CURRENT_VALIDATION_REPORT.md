# Current validation report

**Generated at commit:** `1253b363ee0d19010f3a0f03c33f7b8c41b7104b`
**Working tree:** clean apart from this report
**Bound to tree:** `sha256:954dbcafedf84438ffd98d91d23708d6e54e612c6b98dc1054a843b81c726c7d`
**Generated:** 2026-10-30T21:09:45.069Z

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
| `npm run validate` | 1 | **FAIL** | the aggregate gate |

## Failures

### `npm run validate` — exit 1

```
[l9-meta-injector] coverage: scanned=1 injected=1 skipped-binary=0 skipped-noninjectable=0 archives-expanded=1 verify-failed=0 report=/tmp/l9-reingest-zjOjwg.out/coverage-report.json
[l9-meta-injector] coverage: scanned=7 injected=6 skipped-binary=0 skipped-noninjectable=1 archives-expanded=0 verify-failed=0 report=/tmp/l9-mft-PBbHnz/coverage-report.json
[l9-meta-injector] local-files: expanded 2 archive(s) under /tmp/l9-archive-convergence-fuanhP
[l9-meta-injector] local-files: expanded 2 archive(s) under /tmp/l9-archive-convergence-idISSm
[l9-meta-injector] local-files: expanded 1 archive(s) under /tmp/l9-archive-convergence-g0V13e
[l9-meta-injector] local-files: expanded 1 archive(s) under /tmp/l9-archive-convergence-izW64g
[l9-meta-injector] local-files: expanded 1 archive(s) under /tmp/l9-archive-convergence-izW64g
[l9-meta-injector] local-files: expanded 1 archive(s) under /tmp/l9-path-conflict-pzCVo7
[l9-meta-injector] local-files: expanded 1 archive(s) under /tmp/l9-path-conflict-rPdGmq
[l9-meta-injector] local-files: expanded 1 archive(s) under /tmp/l9-path-conflict-FWHsHQ
[l9-meta-injector] coverage: scanned=2 injected=1 skipped-binary=0 skipped-noninjectable=1 archives-expanded=0 verify-failed=0 report=/tmp/l9-cov-1793394573892-ofetgx3ob5/coverage-report.json
[l9-meta-injector] coverage: scanned=1 injected=0 skipped-binary=0 skipped-noninjectable=1 archives-expanded=0 verify-failed=0 report=/tmp/l9-cov-1793394573919-nmx2z35fe7/coverage-report.json
[l9-meta-injector] coverage: scanned=2 injected=1 skipped-binary=0 skipped-noninjectable=1 archives-expanded=0 verify-failed=0 report=/tmp/l9-cov-1793394573929-qs308xwnhy/coverage-report.json
[l9-meta-injector] verification FAILED for 1/1 file(s):
  - /tmp/l9-verify-1793394574844-x3ee1rz2o1g/prompts/Prompt-Incomplete.md: Prompt schema 'role' is Unknown; Prompt schema 'objective' is Unknown; Prompt schema 'input_variables' is Unknown; Prompt schema 'output_format' is Unknown; Prompt schema 'model_target' is Unknown
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm network_error: network error [0ms]
[l9-meta-injector] llm http_error (status 429): rate limited [0ms]
[l9-meta-injector] llm parse_error (status 200): Unexpected token [0ms]
[l9-meta-injector] llm timeout: aborted [0ms]
[l9-meta-injector] llm network_error: ECONNREFUSED [0ms]
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
architecture manifest is stale; run npm run manifest:update
```

## Verdict

**RED**

At least one command failed. The tail of its output is above; this tree is not green.

## What this report does not say

- It is not a publication authorization. `npm run check:publication` is a
  separate gate and remains fail-closed on its own evidence.
- It is not a statement about any other tree. Re-run it on the tree you mean to
  make a claim about.
- `[l9-meta-injector] verification FAILED for 1/1 file(s)` lines inside the
  Vitest output are fail-closed negative-path fixtures asserting their own
  refusal, not failures; the exit codes in the table are the authority.
