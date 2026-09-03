# Current validation report

**Generated at commit:** `638aee192542e7490fd6d9c1321cd84561c1ec41`
**Working tree:** clean apart from this report
**Bound to tree:** `sha256:c4118d6573fb0c86ea0db298a4986bc9db58c3d60b900fed1c4f37b4fcae8ad2`
**Generated:** 2026-09-03T00:37:04.591Z

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
[l9-meta-injector] local-files: expanded 2 archive(s) under /tmp/l9-archives-Y6VTQX
[l9-meta-injector] coverage: scanned=4 injected=4 skipped-binary=0 skipped-noninjectable=0 archives-expanded=2 verify-failed=0 report=/tmp/l9-archives-zSa4Oz/coverage-report.json
[l9-meta-injector] local-files: expanded 1 archive(s) under /tmp/l9-reingest-ZhteCq
[l9-meta-injector] coverage: scanned=1 injected=1 skipped-binary=0 skipped-noninjectable=0 archives-expanded=1 verify-failed=1 report=/tmp/l9-reingest-ZhteCq.out/coverage-report.json
[l9-meta-injector] local-files: expanded 2 archive(s) under /tmp/l9-archive-convergence-TMq3bO
[l9-meta-injector] local-files: expanded 2 archive(s) under /tmp/l9-archive-convergence-ihrmPV
[l9-meta-injector] local-files: expanded 1 archive(s) under /tmp/l9-archive-convergence-b0yZ5K
[l9-meta-injector] local-files: expanded 1 archive(s) under /tmp/l9-archive-convergence-1F7KgC
[l9-meta-injector] local-files: expanded 1 archive(s) under /tmp/l9-archive-convergence-1F7KgC
[l9-meta-injector] coverage: scanned=2 injected=1 skipped-binary=0 skipped-noninjectable=1 archives-expanded=0 verify-failed=0 report=/tmp/l9-cov-1788395804914-j2iuwn90r6c/coverage-report.json
[l9-meta-injector] coverage: scanned=1 injected=0 skipped-binary=0 skipped-noninjectable=1 archives-expanded=0 verify-failed=0 report=/tmp/l9-cov-1788395804940-h3gbiqbbdui/coverage-report.json
[l9-meta-injector] local-files: expanded 1 archive(s) under /tmp/l9-path-conflict-JrsVVq
[l9-meta-injector] local-files: expanded 1 archive(s) under /tmp/l9-path-conflict-N29eFl
[l9-meta-injector] verification FAILED for 1/1 file(s):
  - /tmp/l9-verify-1788395806128-aio0fgemm4u/prompts/Prompt-Incomplete.md: Prompt schema 'role' is Unknown; Prompt schema 'objective' is Unknown; Prompt schema 'input_variables' is Unknown; Prompt schema 'output_format' is Unknown; Prompt schema 'model_target' is Unknown
[l9-meta-injector] llm http_error (status 429): rate limited [0ms]
[l9-meta-injector] llm parse_error (status 200): Unexpected token [1ms]
[l9-meta-injector] llm timeout: aborted [0ms]
[l9-meta-injector] llm network_error: ECONNREFUSED [0ms]
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm network_error: network error [0ms]
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
