# L9 Audit Suite — Run Report (l9-meta-injector)

- **Tool:** l9-audit-suite v0.6.0 (consolidated), 10-audit report-only suite
- **Target:** `l9-meta-injector` @ `3fba77d` (branch `claude/audit-tool-6gdakx`)
- **Mode:** report-only. No source files were modified by the audit.
- **Machine-readable findings:** [`L9_AUDIT_SUITE_FINDINGS.json`](./L9_AUDIT_SUITE_FINDINGS.json) (schema-conformant per `finding_schema.json`)
- **Top emitted task contract:** [`L9_AUDIT_SUITE_task-ACA-003.yaml`](./L9_AUDIT_SUITE_task-ACA-003.yaml)

## How this was run

The suite's Python is orchestration glue; the substance is 10 markdown directives meant to be
executed by an agent. Each directive was executed against the real TypeScript source, then the
findings were consolidated and passed through the suite's own `one_command_chain.py`, which built
the priority queue (MSNA → blocks_release → severity) and emitted the first Flawless-Victory task
contract. Audit 05 (follow-up/remediation-verification) is post-remediation only and was not run.

## Result summary

**43 findings** — 11 high, 20 medium, 12 low. **2 release-blockers.**

| Audit | Domain | Findings |
|---|---|---|
| 01 | architecture-conformance | 5 |
| 02 | security-dataflow | 3 |
| 03 | supply-chain-license | 1 |
| 04 | quality-test-effectiveness | 5 |
| 06 | production-readiness/stub | 2 |
| 07 | recursive-alignment | 4 |
| 08 | dead-wiring/latent-capability | 8 |
| 09 | interface-contract-coupling | 5 |
| 10 | observability/signal-coverage | 10 |

Overall posture: the codebase is **defensively written** (0 runtime dependencies, `npm audit` clean,
strict TypeScript, no `eval`/`exec`/`child_process`, explicit path-traversal sanitization, symlink-skipping
walkers). Security findings are all low-severity hardening items. The dominant themes are **built-but-unwired
capability** (audit 08) and **silent failure / missing run signal** (audit 10).

## Release blockers (fix before ship)

### ACA-003 / PRD-001 — `nearDupThreshold` is a fail-open no-op *(high, blocks release)*
`src/compiler.ts:17` `buildDedupReport(entries, _threshold, _prefixLen)` ignores both params and
`:25` hardcodes `nearDuplicates: []`. The knob is public (`schema.ts:155 nearDupThreshold`), threaded
live through `pipeline.ts:93`, and `buildDedupEntries` even computes an unused `hashPrefix`. Callers
configuring near-duplicate detection silently get none. **Fix:** implement prefix/threshold clustering,
or remove the knob and fail-closed. *(Independently flagged by audits 01 and 06.)*

### OBS-002 — verification result is computed but never consumed *(high, blocks release)*
`src/pipeline.ts:91-103` runs `verify(...)` producing `VerifyResult[]` (including
`bodyPreserved=false` — a body-corruption signal from `verify.ts:60`) but never inspects `issues`;
it only writes `verification-report.json`, and that write is gated behind `if (!config.dryRun)`.
`runPipelineAsync` returns success regardless. A run that corrupted file bodies reports clean success.
**Fix:** aggregate issues, log a summary, and throw or return `hadVerificationFailures` so CI can gate.

## High-severity, non-blocking

- **DWL-001** — the tested 17-class semantic classifier (`classifyWithSemantics`/`artifact_class.ts`) never feeds injected metadata; the pipeline uses only coarse `classify()`.
- **DWL-002** — the placement-policy compiler (`compilePlacementPlans`) has no runtime caller; reachable only from unit tests.
- **DWL-003 / RAA-001** — the entire MetaV3 nine-plane model (`schema.ts:166-290`) has no producer or consumer; documented in `contracts.md` as active behavior but unimplemented.
- **ACA-001** — two parallel injection engines (TS sentinel blocks vs Python `<!-- L9_META -->`); neither strips the other's headers, so cross-tool re-runs duplicate metadata.
- **OBS-001** — `makeOpenAIAdapter` collapses every LLM failure (timeout/4xx/5xx/parse) into a bare `null` with no logging.
- **OBS-003** — `runPipelineAsync` emits no coverage tally (scanned/injected/skipped/verify-failed).
- **OBS-004** — `inventory.ts:302` swallows an `injectFile` error with no record.
- **QTE-001** — `src/compiler.ts` (a critical, every-run path) has zero test coverage.
- **QTE-002** — the only LLM-adapter test asserts `typeof classify === 'function'` and nothing about behavior.

## Cross-audit corroboration (same defect, multiple lenses)

- **MetaV3 dead contract:** DWL-003 (08) + RAA-001 (07)
- **`FieldDiff` duplicated type:** ACA-004 (01) + ICC-001 (09)
- **`SharingScope` duplicated type:** RAA-002 (07) + ICC-002 (09)
- **Sidecar write swallowed:** PRD-002 (06) + OBS-006 (10)
- **`nearDupThreshold` stub:** ACA-003 (01) + PRD-001 (06)

These independent hits raise confidence — the findings are structural, not lens artifacts.

## Priority queue (top of the emitted order)

`ACA-003` (MSNA) → `OBS-002` → `ACA-001` → `DWL-001` → `DWL-002` → `DWL-003` → `OBS-001` → `OBS-003`
→ `OBS-004` → `QTE-001` → `QTE-002` → … (full order in the findings JSON via `one_command_chain.py`).

## Leverage gate note

Findings carry a `leverage_preflight` self-score and a computed `leverage_score`. Under the kernel's
2.5 reject threshold, 14 findings would auto-promote and 29 would defer — meaning most cleanups are
locally valuable but low compounding-leverage. The two release-blockers should be driven by severity,
not the leverage gate.

## Suite defects found while running the tool

Independent of the target, three doc/code-drift bugs in l9-audit-suite v0.6.0 surfaced during the run:
1. README documents a `--verify-report` flag on `one_command_chain.py` that does not exist (argparse rejects it).
2. `finding_schema.py`'s no-pydantic fallback stubs `BaseModel` but not `Field`, so `audit_to_contract.py` crashes with `NameError: Field` unless pydantic is installed.
3. `examples/example_findings.json` has no `leverage_preflight` blocks, so all fixtures score 0.0 and are auto-blocked — the gate can't be demonstrated with shipped data, contradicting the README.
