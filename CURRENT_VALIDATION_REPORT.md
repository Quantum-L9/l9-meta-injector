# Current validation report

**Generated at commit:** `de151f3adeccf2d97d85c040f46c97446fd5ea05`
**Working tree:** **dirty** — this report describes uncommitted changes
**Bound to tree:** `sha256:fd83db0048bfbabfea323d054df4aa73004a411b1f31218791ef072b383432f6`
**Generated:** 2026-09-01T19:05:06.792Z

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
| `npm run validate` | 1 | **FAIL** | the aggregate gate |

## Failures

### `npm run validate` — exit 1

```
[l9-meta-injector] local-files: expanded 2 archive(s) under /var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-archives-SNJEUX
[l9-meta-injector] coverage: scanned=4 injected=4 skipped-binary=0 skipped-noninjectable=0 archives-expanded=2 verify-failed=0 report=/var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-archives-G7d0kA/coverage-report.json
[l9-meta-injector] coverage: scanned=2 injected=1 skipped-binary=0 skipped-noninjectable=1 archives-expanded=0 verify-failed=0 report=/var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-cov-1788289497069-8he7lpsd6j8/coverage-report.json
[l9-meta-injector] coverage: scanned=1 injected=0 skipped-binary=0 skipped-noninjectable=1 archives-expanded=0 verify-failed=0 report=/var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-cov-1788289497096-yr62ts0pj1k/coverage-report.json
[l9-meta-injector] verification FAILED for 1/1 file(s):
  - /var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-verify-1788289499293-con5l14xj6v/prompts/Prompt-Incomplete.md: Prompt schema 'role' is Unknown; Prompt schema 'objective' is Unknown; Prompt schema 'input_variables' is Unknown; Prompt schema 'output_format' is Unknown; Prompt schema 'model_target' is Unknown
[l9-meta-injector] llm http_error (status 429): rate limited [0ms]
[l9-meta-injector] llm parse_error (status 200): Unexpected token [0ms]
[l9-meta-injector] llm timeout: aborted [0ms]
[l9-meta-injector] llm network_error: ECONNREFUSED [0ms]
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm network_error: network error [0ms]
dist-integrity: FAILED: dist is dirty before validation
  dirty:  M dist/archives.d.ts
  dirty:  M dist/archives.js
  dirty:  M dist/archives.js.map
  dirty:  M dist/local_source.d.ts
  dirty:  M dist/local_source.js
  dirty:  M dist/local_source.js.map
  dirty: ?? dist/archive_execution.d.ts
  dirty: ?? dist/archive_execution.js
  dirty: ?? dist/archive_execution.js.map
```

## Verdict

**RED**

At least one command failed. The tail of its output is above; this tree is not green.

## What this report does not say

- It is not a publication authorization. `npm run check:publication` is a
  separate gate and remains fail-closed on its own evidence.
- It is not a statement about any other commit. Re-run it on the tree you mean
  to make a claim about.
- `[l9-meta-injector] verification FAILED for 1/1 file(s)` lines inside the
  Vitest output are fail-closed negative-path fixtures asserting their own
  refusal, not failures; the exit codes in the table are the authority.
