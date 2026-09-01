# Current validation report

**Generated at commit:** `03b717276bfa0215377611b3391f1f7308157e90`
**Working tree:** **dirty** — this report describes uncommitted changes
**Bound to tree:** `sha256:787313ef005aad22b255e5193f7c55af9bed3e089ce94ffc7bc428087645e00b`
**Generated:** 2026-09-01T19:33:08.070Z

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
[l9-meta-injector] local-files: expanded 1 archive(s) under /var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-archives-EwEZRX
[l9-meta-injector] local-files: refusing to expand /var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-archives-UZUoNh/Empty.zip: extraction target exists, is empty, and carries no v2 ownership marker, so it is treated as user data and never replaced: /var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-archives-UZUoNh/Empty.l9extracted
[l9-meta-injector] local-files: expanded 1 archive(s) under /var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-archives-UZUoNh
[l9-meta-injector] local-files: expanded 1 archive(s) under /var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-archives-RI8Vzc
[l9-meta-injector] coverage: scanned=5 injected=5 skipped-binary=0 skipped-noninjectable=0 archives-expanded=1 verify-failed=0 report=/var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-archives-G0seGB/coverage-report.json
[l9-meta-injector] local-files: expanded 3 archive(s) under /var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-archives-8NzP3z
[l9-meta-injector] local-files: expanded 1 archive(s), omitted 1 under /var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-archives-AFtPGJ
[l9-meta-injector] local-files: expanded 2 archive(s) under /var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-archives-AFtPGJ
[l9-meta-injector] coverage: scanned=4 injected=4 skipped-binary=0 skipped-noninjectable=0 archives-expanded=2 verify-failed=0 report=/var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-archives-ALkxJ5/coverage-report.json
[l9-meta-injector] coverage: scanned=2 injected=1 skipped-binary=0 skipped-noninjectable=1 archives-expanded=0 verify-failed=0 report=/var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-cov-1788291178602-ey179y7lwj/coverage-report.json
[l9-meta-injector] coverage: scanned=1 injected=0 skipped-binary=0 skipped-noninjectable=1 archives-expanded=0 verify-failed=0 report=/var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-cov-1788291178623-fbm09ghmtmr/coverage-report.json
[l9-meta-injector] verification FAILED for 1/1 file(s):
  - /var/folders/y0/0lghf1112pj1747ldqz7zd4r0000gn/T/l9-verify-1788291179126-j8hpljs4vvk/prompts/Prompt-Incomplete.md: Prompt schema 'role' is Unknown; Prompt schema 'objective' is Unknown; Prompt schema 'input_variables' is Unknown; Prompt schema 'output_format' is Unknown; Prompt schema 'model_target' is Unknown
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm network_error: network error [0ms]
[l9-meta-injector] llm network_error: refusing to send credential to non-https baseUrl [0ms]
[l9-meta-injector] llm http_error (status 429): rate limited [0ms]
[l9-meta-injector] llm parse_error (status 200): Unexpected token [0ms]
[l9-meta-injector] llm timeout: aborted [0ms]
[l9-meta-injector] llm network_error: ECONNREFUSED [0ms]
dist-integrity: FAILED: committed dist differs from isolated source build
  changed: archives.js
  changed: archives.js.map
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
