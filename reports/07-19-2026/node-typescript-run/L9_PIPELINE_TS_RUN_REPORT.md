# L9 Auditor → Planner → Remediator — Node/TypeScript Run Report

- **Suite:** `l9-auditor-planner-remediator-suite` **+ `l9-node-typescript-addon` v1.0.0**
  (the second uploaded archive, which adds Node/TS coverage).
- **Target:** `l9-meta-injector` @ `5359d6f` (branch `claude/audit-plan-remediate-pipeline-m6a50v`).
- **Mode:** report-only. **No source files were modified.** Working tree stayed clean throughout.
- **Artifacts:** [`artifacts/`](./artifacts/) (node audit → validator plan → planning input → plan manifest → remediator ledger).

## Why this run is different

The first run (`../pipeline-artifacts/`) used the shipped **Python-oriented** core rulepacks
and produced **zero** findings on this TypeScript repo. This archive adds
`auditor/addons/l9-node-typescript-addon/` — deterministic Node/TS profiling, source-rule
providers, a validator-plan resolver, and language-neutral findings for the planner. **With it,
the pipeline now produces real, governed output end-to-end.**

## Result summary

| Stage | Tool | Outcome | Result |
|---|---|---|---|
| 1. Audit | `l9-node-audit` | **`complete`** | node ecosystem detected; 4 providers; **9 findings** |
| 1b. Validator plan | `l9-node-validator` | ok | resolved real repo gates: `npm run typecheck / lint / test / build` |
| 2. Plan | `l9_planner` | exit 0 | manifest `MAN-f685a1bcbaf1b51f21b61871`, governance **passed**, 9 eligible → **5 selected** |
| 3. Remediate | `agent_b_remediator.cli` | `failed` *(by design)* | 5 real tasks loaded + verified; each **fail-closed** under a no-op agent; repo untouched |

## Stage 1 — Node/TS Auditor (addon v1.0.0)

```
l9-node-audit /home/user/l9-meta-injector --minimum-confidence 0.6 --minimum-severity low
```

- Ecosystem `node`; languages `javascript`, `typescript`; providers executed:
  `node.repository-profile`, `node.package-json`, `typescript.config`, `typescript.source`.
- File classification: 240 supported-text, 0 binary, 0 unreadable, 0 oversized → **outcome `complete`**
  (the addon treats expected binary assets as `supported_binary`, so they no longer force `partial`).
- **9 observations = 9 qualified findings:**

| Rule | Severity | Conf | Location |
|---|---|---|---|
| `process-exit-library-code` | medium | 0.82 | `scripts/inventory.js:28,33,39,47` |
| `process-exit-library-code` | medium | 0.82 | `scripts/selfpack.js:35,168` |
| `weak-security-randomness` | medium | 0.75 | `tests/pipeline_coverage.test.ts:7` |
| `weak-security-randomness` | medium | 0.75 | `tests/pipeline_verification.test.ts:7` |
| `weak-security-randomness` | medium | 0.75 | `tests/pipeline_wiring.test.ts:8` |

## Triage — these are real matches but context-appropriate (not auto-remediated)

I reviewed every hit against its source. **All nine are legitimate matches of the lexical rule
firing in contexts where the pattern is correct**, which is exactly why the pipeline separates
*observation* from *qualified finding* from *human-approved remediation*:

- **`process.exit()` (6×)** — all in **CLI entry-point scripts** (`scripts/inventory.js`,
  `scripts/selfpack.js`). Setting a process exit code from a top-level command's `main` is
  idiomatic and correct; the rule targets "library or request-path" code, which these are not.
- **`Math.random()` (3×)** — all in **test helpers** building unique temp-dir names
  (`` `l9-cov-${Date.now()}-${Math.random().toString(36)…}` ``). Not security-sensitive token
  generation.

None warrant a code change; auto-rewriting them would degrade correct code. A human would
disposition them `advisory`/`review`. **I therefore ran the remediator with a no-op agent rather
than wiring an auto-fixer** — and the remediator's refusal to fabricate a completion (below) is
the desired safety property, not a failure.

## Stage 2 — Planner (Agent A, v1.3.0)

Findings were mapped into `l9.planning-input.v1` per
`planner/contracts/node-typescript-finding-adapter.json`; `validation_commands` are the
addon-resolved repo gates.

```
l9_planner planning-input.json --policy default-planning-policy.json --output-root ./reports
```

- Manifest **`MAN-f685a1bcbaf1b51f21b61871`** (`l9.remediation-manifest.v4`), governance **passed**,
  `ready_for_remediator: true`.
- **9 eligible → 5 selected** (10 effort points). The 4 unselected are same-file path-conflicts:
  the planner's `infer_path_conflicts` + `maximum_files_changed: 5` budget selects **one
  representative finding per file**, so a plan touches ≤ 5 files. Selected: one each in
  `scripts/inventory.js`, `scripts/selfpack.js`, and the three test files.
- Each task carries a validator contract = targeted repo gates **plus** an auto-added
  `auditor-regression` assertion (`expected_active_candidate_count: 0`).

## Stage 3 — Remediator (Agent B, R1 / v0.2.0)

The R1 remediator consumes the `l9.remediation_manifest.v1` generation, so the v4 plan was
mechanically translated (top-level `base_ref`; per-contract `finding_id`, bash `validator_file`
running the resolved gates, `validator_manifest` @ `l9.validator_stub.v1`, `followup_file`,
`allowed_paths`). No finding content was invented.

```
agent_b_remediator.cli remediator-manifest.json --repository <repo> \
  --remediation-command true --continue-on-failure
```

- Verified Git repo, **clean tree**, and manifest `base_ref` == `HEAD` (`5359d6f`).
- Loaded all **5 real task contracts** and ran the full state machine per task
  (hash-chained ledger `RUN-03cecd7e…`, `l9.execution-ledger.v1`, 20 events):

  `verified → remediation_started → remediation_completed → execution_failed`
  ("remediation command completed but produced no repository changes")

- `final_status: failed`, 5 failed, 0 completed — **the correct fail-closed outcome for a no-op
  agent.** The remediator will not mark a task complete or write a receipt without real authorized
  changes. **Repository working tree unchanged**; no commit/branch/push/PR (forbidden at R0/R1).

## Interpretation

1. **The Node/TS addon closes the coverage gap** flagged in the first run. The same three agents
   now run green on real TypeScript input: audit `complete` (9 findings), a governed 5-task plan,
   and a remediator that loads and enforces real contracts.
2. **Zero-value ≠ zero-findings.** The addon surfaces true pattern matches, but on this
   defensively-written repo they land in legitimate CLI/test contexts. That is a *precision*
   observation about the shipped `typescript.source` rules (they lack a `scripts/**` and
   `tests/**` exclusion for `process-exit`/`Math.random`), not a defect list for the repo.
3. **To make remediation productive**, either tighten the addon rules (exclude CLI entrypoints and
   test files, as the Python `core-security` pack already excludes `**/tests/**`), or wire a real
   remediation agent as `--remediation-command` for findings a human has approved. The fail-closed
   machinery is ready for both.

## Standing gaps (unchanged from the first run)

- **Planner (v4) ↔ Remediator (v1) manifest-generation skew** still requires a translator for
  non-empty plans (done here mechanically). The archive notes the remediator stops at R1 (R2
  source is zero-byte; R3 unapplied).
- **Remediator entry point** has no `__main__.py`; invoke as `python3 -m agent_b_remediator.cli`.

## Reproduction

All stages are deterministic and stdlib-only. Given snapshot `5359d6f`, the finding set, manifest
id, all `*_sha256` values, and the run id reproduce exactly.
