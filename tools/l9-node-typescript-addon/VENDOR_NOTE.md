# Vendor note — l9-node-typescript-addon

This directory vendors the **L9 Node.js/TypeScript auditor add-on** (`l9_node_ts`, v1.0.0)
from the L9 Auditor/Planner/Remediator suite, so the Node/TS audit coverage lives with this
project. It is standalone, standard-library-only Python (>= 3.10) and is **not** part of the
published npm package (`tools/` is excluded by `.npmignore`, and `package.json` `files` is an
allowlist).

## Local modification vs. upstream

The only change from the upstream addon is a **per-rule path exclusion** in
`l9_node_ts/providers/source.py`, mirroring how the suite's Python `core-security` rulepack uses
per-rule `exclude_globs` (e.g. `["**/tests/**"]`).

A new `exclude_dirs` field was added to the `Rule` dataclass and applied in
`TypeScriptSourceProvider.analyze()` via the addon's existing directory-segment-membership idiom
(the same mechanism used for `PRUNE_DIRECTORIES` in `profile.py`), which is equivalent to
`**/scripts/**` / `**/tests/**` at any depth. Two rules were relaxed:

| Rule | `exclude_dirs` | Why |
|---|---|---|
| `process-exit-library-code` | `('scripts','tests')` | `process.exit()` is idiomatic in CLI entry-point scripts and test harnesses, not "library/request-path" code. |
| `weak-security-randomness` | `('tests',)` | `Math.random()` in tests builds unique temp-dir names — not security-sensitive token generation. |

**Security-critical rules are left global** (unchanged): `eval-usage`, `new-function-usage`,
`insecure-tls-verification`, and `unbounded-promise-all` still scan `scripts/**` and `tests/**`.

## Rationale

Auditing this repository originally produced 9 findings, all context-appropriate false positives:
6× `process.exit()` in `scripts/inventory.js` + `scripts/selfpack.js`, and 3× `Math.random()` in
`tests/pipeline_*.test.ts`. The tightening removes exactly this noise without weakening genuine
security detection.

## Verification

- **Re-audit of this repo** after the change: **0 observations / 0 qualified findings**, outcome
  `complete` (was 9 findings).
- **Addon test suite:** 4/4 pass (the `eval-usage` fixture lives in `src/`, so it is unaffected).
- **Per-rule behavior guard:** on a synthetic repo, `process.exit`/`Math.random` are suppressed
  under `scripts/`+`tests/` while `eval()` is **still flagged** in those same directories —
  confirming the exclusion is per-rule, not blanket.

## Usage

```bash
PYTHONPATH=tools/l9-node-typescript-addon python3 -c \
  "from l9_node_ts.cli import audit_main; import sys; sys.exit(audit_main(['.']))"
```

Entry points (see `pyproject.toml`): `l9-node-profile`, `l9-node-audit`, `l9-node-validator`,
`l9-node-followup`.
