# E2E Validation Evidence — l9-meta-injector

- **HEAD SHA:** `17a4820757bc499bb8eeb90119e74e7d07eeacfc`
- **Target under test:** compiled package `dist/index.js` (the artifact npm would publish)
- **API exercised:** `runPipelineAsync` (documented in README as the programmatic entrypoint)
- **Isolation:** all fixture I/O in an OS tmp dir; repo working tree untouched (`git status --short` empty before, during, and after)

## Why this flow

The package exposes **no CLI/`bin`**, so the documented and only supported runtime
surface is programmatic. The e2e imports the **built `dist/`** (not `src/`) to validate
the packaged artifact, then drives the full documented pipeline
`classify → extract → assist → inject → verify → index` with `dryRun: false` and
`llmEnabled: false` (no network). Input shape matches the documented example in
`README.md` / `tests/pipeline_integration.test.ts` — not invented.

## Command

```
node <scratch>/e2e_driver.js      # requires /home/user/l9-meta-injector/dist/index.js
exit code: 0
```

## Real output observed

Injected YAML frontmatter written to the source markdown (first lines):

```
---
id: l9.skill.lint_file
title: lint file
artifact_type: skill
mcp_primitive: tool
callable: true
retrievable: true
injectable: true
namespace: l9
sharing_scope: agnostic
source_path: <tmp>/root/skills/lint_file.md
content_hash: 127f4eeb324d47dba70fc815fdec8a1edd635a3c647779013c215b996af145fa
token_cost_estimate: 60
authority: l9.doctrine.platform
```

Index/report artifacts written to `outDir`:

```
dedup-report.json
dedup-report.md
primitive-library-index.json
prompt-library-index.json
verification-report.json
```

Verification report contents (per injected file):

```
yamlValid: true, bodyPreserved: true, taxonomyValid: true,
promptSchemaComplete: true, sharingScopeValid: true, issues: []
```

## Assertions (12/12 PASS)

| # | Assertion | Result |
|---|---|---|
| 1 | `result.scanned.length === 1` | PASS |
| 2 | `result.injected.length > 0` | PASS |
| 3 | `result.verified` present & non-empty | PASS |
| 4 | injected file starts with `---` (frontmatter) | PASS |
| 5 | contains `namespace: l9` | PASS |
| 6 | contains `artifact_type:` | PASS |
| 7 | contains `id:` | PASS |
| 8 | `primitive-library-index.json` written | PASS |
| 9 | `prompt-library-index.json` written | PASS |
| 10 | `dedup-report.json` written | PASS |
| 11 | `verification-report.json` written | PASS |
| 12 | verification: all invariant flags `true`, `issues: []` | PASS |

**E2E_RESULT: PASS**

## Note on evidence integrity

An earlier run of the driver reported a single FAIL on assertion 12 because the driver
asserted a non-existent `ok` field. Inspection of the real `VerifyResult` schema
(`src/verify.ts`) showed the correct fields (`yamlValid`, `bodyPreserved`,
`taxonomyValid`, `promptSchemaComplete`, `sharingScopeValid`, `issues`). The driver
assertion was corrected to the actual schema and the flow re-run to a clean 12/12 PASS.
This was a harness bug in the test driver, **not** a product defect — the product's
verification output was correct (all flags `true`, `issues: []`) in both runs.
