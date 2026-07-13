<!-- L9_META
l9_schema: 1
parent: l9-pr-remediation
layer: reference
role: validation_gates
tags: [pr, validation, enforcement, checkpoints, artifacts]
owner: igor_beylin
status: active
version: 2.1.0
updated: 2026-06-18
/L9_META -->

# Validation Gates (Enforcement Layer)

## Purpose

Prevent protocol violations by requiring concrete artifacts at each workflow step. Rules without validation are suggestions. This file defines the **proof-of-compliance** checkpoints that the agent MUST produce before advancing to the next step.

## Gate Architecture

```text
Step 2 ──→ [GATE A] ──→ Step 3-4 ──→ [GATE B] ──→ Step 5 ──→ [GATE C] ──→ Step 6 ──→ [GATE D] ──→ Step 7 ──→ [GATE E] ──→ Step 7.5 ──→ [GATE F] ──→ Step 8
```

Each gate requires a specific artifact. If the artifact is missing or invalid, the agent MUST NOT proceed.

## Gate A: Gate Discovery Complete

**After Step 2 (Discover CI gates)**

Required artifact:
```yaml
# MUST be produced and logged before proceeding
gate_registry:
  total_gates: {integer >= 1}
  gates:
    - name: "{gate_name}"
      command: "{exact command}"
      source: "{workflow_file}:{step_name}"
      can_run_locally: true | false
      requires_secrets: true | false
```

Validation:
- [ ] `total_gates >= 1` (every repo has at least one CI step)
- [ ] Every gate has a `command` field (not empty)
- [ ] Every gate has a `source` traced to a workflow file

**STOP if:** No workflow files found → ask user if CI is configured.

## Gate B: Ingestion and Classification Complete

**After Steps 3-4 (Ingest + Classify)**

Required artifact:
```yaml
classified_findings:
  blocking: [{count}]
  actionable: [{count}]
  discussion: [{count}]
  deferred: [{count}]
  total: {integer}

execution_plan:
  cycle_scope: ["{finding-id}", ...]
  estimated_files: ["{file_path}", ...]
  local_verify_commands: ["{command}", ...]
```

Validation:
- [ ] `total >= 1` (if 0 findings, nothing to fix — skip to convergence)
- [ ] `cycle_scope` is non-empty (at least one finding to fix)
- [ ] `local_verify_commands` matches gate registry (all gates included)
- [ ] Every finding has an `id`, `source`, `severity`, and `message`

**STOP if:** Total findings is 0 AND CI is green → already converged, emit report.

## Gate C: All Fixes Applied (Pre-Verify)

**After Step 5 (Apply ALL fixes)**

Required artifact:
```bash
# Run and capture output
git diff --stat
```

Validation:
- [ ] `git diff --stat` shows changes (non-empty diff)
- [ ] Number of files changed is reasonable (≤ `estimated_files` count + 2 tolerance)
- [ ] No unrelated files modified (compare against `estimated_files`)
- [ ] ALL findings in `cycle_scope` have been addressed (internal tracking)

**STOP if:** Diff is empty → no fixes were actually applied. Re-read findings and try again.

## Gate D: Local Verify Passed (CRITICAL GATE)

**After Step 6 (Local verify)**

Required artifact:
```yaml
local_verify_log:
  iteration: {integer}  # which attempt (1-5)
  timestamp: "{ISO}"
  gates_run: {integer}
  gates_passed: {integer}
  all_green: true
  results:
    - gate: "{gate_name}"
      command: "{command}"
      exit_code: 0
      duration_ms: {integer}
    - gate: "{gate_name}"
      command: "{command}"
      exit_code: 0
      duration_ms: {integer}
```

Validation:
- [ ] `all_green: true` (every gate exit code is 0)
- [ ] `gates_run == gate_registry.total_gates` (no gates skipped)
- [ ] `iteration <= 5` (max local verify attempts not exceeded)
- [ ] Every gate from the registry appears in results

**STOP if:** `all_green: false` after iteration 5 → defer problematic findings, re-run verify on remaining.
**STOP if:** `gates_run < gate_registry.total_gates` → missing gates, re-run ALL.

**This is the ONLY gate that blocks push. If this artifact doesn't show all_green: true, pushing is a protocol violation.**

## Gate E: Single Commit, Single Push

**After Step 7 (Commit and push)**

Required artifact:
```yaml
push_record:
  commit_sha: "{full_sha}"
  commit_message: "{conventional commit message}"
  files_in_commit: {integer}
  push_count_this_cycle: 1
  branch: "{branch_name}"
  pushed_at: "{ISO timestamp}"
```

Validation:
- [ ] `push_count_this_cycle == 1` (protocol violation if > 1)
- [ ] `commit_sha` is a valid 40-char hex string
- [ ] Commit message follows convention: `fix(pr-remediation): cycle {N} — ...`
- [ ] `git log --oneline HEAD~1..HEAD` returns exactly 1 line

**STOP if:** Push failed → check auth, remote, branch protection. Ask user if needed.

## Gate F: Review Replies Complete

**After Step 7.5 (Reply to review threads)**

Required artifact:
```yaml
reply_record:
  threads_total: {integer}
  threads_replied: {integer}
  threads_resolved: {integer}
  issues_created: {integer}  # for deferred items
  batch_summary_posted: true
  reply_breakdown:
    fixed: {count}
    deferred: {count}
    acknowledged: {count}
    disagreed: {count}
```

Validation:
- [ ] `threads_replied == threads_total` (every thread got a reply)
- [ ] `threads_resolved == threads_total` (every thread resolved)
- [ ] `issues_created >= deferred_count` (every deferred item has an issue)
- [ ] `batch_summary_posted: true`
- [ ] Every reply follows canonical format (Format A/B/C/D)

**STOP if:** GitHub API rate limit hit → wait 60s, retry. If still failing, log partial and continue to convergence.

## Protocol Violation Detection

If at ANY point the agent:
- Pushes without Gate D artifact showing `all_green: true` → **VIOLATION: push-before-verify**
- Makes more than 1 push per cycle → **VIOLATION: multi-push**
- Skips Gate A (no gate registry built) → **VIOLATION: blind-fixing**
- Leaves threads unresolved after Step 7.5 → **VIOLATION: silent-fix**

Violations MUST be:
1. Logged in the convergence report under `protocol_violations`
2. Reported to the user
3. Used to improve the skill (feedback loop)

## Enforcement Mechanism

The agent MUST produce each gate artifact **in the response/working notes** before proceeding. The artifacts serve as:
1. **Proof of compliance** — auditable trail that the protocol was followed
2. **Self-check** — producing the artifact forces the agent to actually do the work
3. **Rollback anchor** — if something goes wrong, the artifacts show exactly where

If an artifact cannot be produced, the agent is stuck at that gate and MUST either:
- Fix the issue preventing artifact production
- Ask the user for help
- Emit a `blocked` convergence status
