<!-- L9_META
l9_schema: 1
parent: l9-pr-remediation
layer: reference
role: convergence_loop
tags: [pr, convergence, loop, polling, ci, local-verify]
owner: igor_beylin
status: active
version: 2.0.0
updated: 2026-06-18
/L9_META -->

# Convergence Loop

## Purpose

After pushing fixes (which have ALREADY passed local verification), wait for CI to confirm, check for new reviews, then determine whether another remediation cycle is needed or convergence has been reached.

## Key Principle: Local-First Verification

Remote CI polling is a **CONFIRMATION** step, not a **DISCOVERY** step.

- ALL failures MUST be caught by local verify BEFORE push.
- If remote CI finds something local verify missed, that's a protocol failure.
- Document any local/remote delta as a finding for the next cycle.

This means: after push, CI SHOULD pass. Polling is to confirm and to catch environment-specific deltas (secrets, services, OS differences).

## Loop Architecture

```text
┌─────────────────────────────────────────────────────────┐
│              REMEDIATION CYCLE                            │
│                                                          │
│  ingest → classify → fix ALL → local verify (GATE) →    │
│  commit (ONE) → push (ONE)                               │
│                                                          │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              CONVERGENCE CHECK                            │
│                                                          │
│  1. Wait for CI completion (confirmation only)           │
│  2. Check CI status                                      │
│  3. Check for new review comments                        │
│  4. Evaluate convergence gate                            │
│                                                          │
│  → converged: STOP + report                              │
│  → not converged (new comments): loop (if cycles < max)  │
│  → CI failed unexpectedly: investigate delta, fix, loop  │
│  → max cycles: STOP + partial report                     │
└─────────────────────────────────────────────────────────┘
```

## Wait Protocol

### Polling CI Status

After push, poll for CI completion:

```bash
# Get the latest run on the PR branch
gh run list --branch {branch} --limit 1 --json databaseId,status,conclusion
```

Poll interval: 45 seconds (since local verify already passed, no urgency).
Max wait: 10 minutes per cycle.

If CI hasn't started after 2 minutes, check if workflows are configured:
```bash
gh workflow list --json name,state
```

### Alternative: Watch mode

```bash
gh run watch {RUN_ID} --exit-status
```

Use when a single run ID is known. Returns exit code 0 on success, non-zero on failure.

### CI Failure After Local Verify Passed

If CI fails despite local verify passing:

1. Fetch the failure logs: `gh run view {RUN_ID} --log-failed`
2. Identify the **delta** — what's different between local and CI:
   - Missing env vars / secrets (expected in CI but not locally)
   - Different Node/Python version
   - Missing system dependencies
   - Network-dependent steps (API calls, package installs)
   - Race conditions in parallel jobs
3. If fixable locally → fix, re-verify, push (counts as same cycle if within the commit).
4. If environment-only → add `continue-on-error` or skip condition, verify, push.
5. If unfixable → defer with reason "CI environment delta".

## Convergence Gate

Convergence is reached when ALL conditions are true:

| Condition | Check Method |
|-----------|-------------|
| CI status is `success` | `gh run view --json conclusion` → `"success"` |
| No new unresolved review comments | Compare comment count/timestamps before and after push |
| All blocking findings resolved | Internal tracking: all `blocking` findings have status `fixed` |
| All actionable findings resolved or deferred | Internal tracking |

## Re-Ingestion (When Not Converged)

When convergence gate fails due to new review comments, re-ingest only NEW signals:

1. **New CI failures**: Only failures on the latest run (not carried over from previous).
2. **New review comments**: Only comments with `created_at` after the last push timestamp.
3. **Resolved comments**: Remove from finding list if a thread was resolved.

Do NOT re-process findings already fixed or deferred in previous cycles.

## Cycle Tracking

Maintain state across cycles:

```yaml
cycle_state:
  current_cycle: 1
  max_cycles: 3
  push_timestamps: ["2026-06-17T10:00:00Z"]
  findings_fixed: ["ci-1", "review-3"]
  findings_deferred: ["review-7"]
  findings_remaining: ["ci-2"]
  ci_status_history: ["success"]  # should be success since local verify passed
  local_verify_gates_count: 6
  local_verify_passed_before_push: true
```

## Convergence Report

When converged OR max cycles reached, emit:

```yaml
convergence_status: converged | partial | blocked
cycles_run: {integer}
max_cycles: 3
cycles_exhausted: true | false
pushes_total: {integer}  # should equal cycles_run
commits_total: {integer}  # should equal cycles_run

findings_summary:
  total_ingested: {integer}
  fixed: {integer}
  deferred: {integer}
  remaining: {integer}

ci_gates_discovered: {integer}
local_verify_iterations: {integer}  # total across all cycles
local_verify_green_before_every_push: true | false

ci_status: success | failure
new_comments_after_final_push: {integer}

deferred_items:
  - id: "review-7"
    reason: "Requires architectural decision — Express vs Fastify"
  - id: "ci-5"
    reason: "Fix caused regression; reverted"

protocol_violations:
  - "None" | list of any batch/verify violations that occurred

minimum_safe_next_action: "merge" | "manual review of deferred items" | "run another cycle manually"
```

## Stop Conditions

MUST stop the loop when:
- `cycles_run >= max_cycles` → emit `partial`
- CI passes AND no new comments → emit `converged`
- A fix causes an unrecoverable regression → emit `blocked`
- GitHub API is rate-limited and retry fails → emit `blocked`
- User sends a stop signal → emit `partial` with current state

## Configuration

Defaults (overridable by user):

```yaml
max_cycles: 3
poll_interval_seconds: 45
max_wait_per_cycle_minutes: 10
max_local_verify_iterations: 5
auto_fix_nits: false          # if true, treat "nit:" as actionable
skip_bot_discussions: true    # skip non-actionable bot comments
parallel_triage_threshold: 3  # use parallel fix when >= 3 independent job failures
```
