<!-- L9_META
l9_schema: 1
parent: l9-repo-preflight
layer: reference
role: delivery_contract
tags: [preflight, delivery, blockers, issues, monitoring, technical-debt, ci-migration]
owner: igor_beylin
status: active
version: 3.3.0
updated: 2026-07-16
/L9_META -->

# Delivery, Accounting & Reporting Contract (v3.3.0)

Separated, independently testable concerns layered on the fail-open loop. All remote effects go through an **MCP-first GitHub adapter**. `GitHubMcpAdapter` is primary; standalone runtimes emit `mcp_action_required` requests for host execution. `GhCliAdapter` is permitted only after MCP reports a capability gap and `--allow-cli-fallback` is explicit. Every operation is idempotent and returns an evidence-bearing receipt; nothing claims a remote action it did not perform.

## Blocker accounting (the core correctness rule)

A **failed applicable autofix is an unresolved blocker.** After the loop,
`accounting.reconcile` maps every attempted action:

| Outcome | Classification |
|---|---|
| autofix succeeded | `resolved` |
| autofix failed | `failed_autofix` → unresolved blocker |
| 401/registry auth (npm/pip) | `inaccessible_private_dependency` → unresolved blocker |
| missing token / no credentials | `missing_token` → unresolved blocker |
| 403 / permission / protected | `missing_permission` → unresolved blocker |
| skipped (not applicable here) | `no_applicable_action` → not a blocker |

`blocker_count` == evaluate's genuine blockers **+** failed-autofix blockers.
`overall_status` is `blocked` while any unresolved blocker remains. A report never
claims zero blockers when a repair failed.

## Autofix delivery (PR)

When file-changing autofixes succeed: stage **only the intended paths** (exclude
unrelated worktree changes), commit with the preflight run reference, push a
deterministic branch, and open a PR against `main`.

- branch: `preflight/autofix-<run-id>` — `run-id` = hash(base_sha + normalized change set), so identical repairs **reuse** the branch/PR (no duplicates).
- title: `fix(preflight): apply automated repository repairs`.
- reports are committed with the change (`docs/preflight/`).
- **never pushes to `main`**; direct pushes to `main` are forbidden.

## Unresolved-blocker issues

Every unresolved blocker opens/updates a GitHub issue, keyed by a stable dedupe key
(`repository + blocker_type + affected_artifact + normalized_failure`): update an
equivalent open issue, reopen an equivalent closed one that is still unresolved, or
create. Bodies carry blocker_id, gate, failed action, **sanitized** command/error,
evidence paths, required human action, reproduction steps, acceptance criteria —
**no secret value ever**. Labels: `preflight`, `blocker`.

## Pull-request monitoring (bounded)

After opening the autofix PR, watch checks/CI/reviews and apply bounded, deterministic
corrections to the same branch (≤ 5 cycles). Auto-fixable: formatting, lint, type
errors, deterministic test failures, broken paths, schema/report failures, actionable
review feedback. Escalate (never guess): missing credentials/permissions, unavailable
private deps, ambiguous architecture, security policy, destructive/protected actions.
Terminal states: `ready_for_human_merge`, `blocked_by_external_dependency`,
`protected_action_requires_approval`, `repair_cycle_limit_reached`.

## Technical-debt detection

Evidence-based scan of the current repo: TODO/FIXME/HACK markers, deprecated
dependencies, stale/duplicate workflows, skipped/disabled tests, missing validation,
unpinned actions. Every finding carries a path (and line where available); findings
are deduplicated; blocking is distinguished from non-blocking; nothing is invented.

## Report persistence

Six deterministic, secret-redacted outputs under `docs/preflight/` (created if
absent), each stamped with run_id, timestamp, source_commit, tool_version:
`preflight-report.md`, `preflight-report.json`, `autofix-log.json`, `blockers.yaml`,
`technical-debt.yaml`, `machine-summary.json`. Committed with the related change; in
`--dry-run` they are written under the work dir (no worktree mutation).

## Reusable-CI changeover (separate PR)

When the repo still has a local CI pipeline, generate the thin caller at
`.github/workflows/ci.yml` delegating to the canonical `l9-ci-core` reusable
workflow pinned to an exact SHA, with `secrets: inherit` and `main` as the target.
Committed/pushed as a **separate** branch (`ci/adopt-l9-ci-core-<run-id>`) and PR
(`ci: adopt canonical l9-ci-core pipeline`) — never mixed with autofix changes.
Validated: yaml parses, no local jobs beyond the reusable call, exact-SHA ref,
`secrets: inherit` present, `main` target.

## Idempotency keys & receipts

- issue: `repository + blocker_type + affected_artifact + normalized_failure`
- autofix PR: `repository + base_sha + normalized_change_set`
- CI PR: `repository + reusable_workflow_ref + target_path`

Every side effect returns a captured receipt (`branch_created`, `commit_created`,
`branch_pushed`, `issue_created_or_updated`, `pull_request_created_or_reused`,
`report_committed`, `monitoring_cycle_completed`). `--dry-run` performs no remote
effect and every receipt reports `dry_run: true`.

## Safety (stop conditions honored)

Never invent credentials/permissions; never weaken the autofix allow-list; never
perform remote side effects while validating the skill itself unless an authorized
test repo is targeted; never log a secret value; never claim a push/issue/PR/CI/
monitoring action without a captured receipt.
