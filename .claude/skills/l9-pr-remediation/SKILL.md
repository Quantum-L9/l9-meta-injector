---
name: l9-pr-remediation
description: recursive pr improvement loop — read ci failures and code review bot comments, apply fixes, push to pr branch, wait for re-run, loop until ci green and no new actionable comments. use when a pr has failing ci, unresolved review comments from gemini or coderabbit, or when the user asks to fix a pr, remediate review feedback, or run a pr improvement loop.
skill_schema: 1
layer: control_plane
role: skill_entrypoint
tags: [l9, pr, ci, code-review, recursive, remediation, github, review-replies]
owner: igor_beylin
status: active
version: 2.1.0
updated: 2026-06-18
---

# PR Remediation Loop

## Purpose

Operate a closed-loop remediation cycle on an open pull request: ingest CI gate failures AND code review bot comments (Gemini, CodeRabbit, GitHub reviewers), apply fixes, verify ALL gates locally, push ONE commit, reply to every review thread with canonical responses, wait for CI confirmation, then loop until converged or max cycles reached.

## Core Contract

| Input | Source | Tool |
|-------|--------|------|
| CI failures | GitHub Actions logs | `gh run view --log-failed` |
| Review comments | PR review threads | `gh api /repos/{owner}/{repo}/pulls/{pr}/reviews` + `gh pr view --comments` |
| Inline suggestions | PR diff comments | `gh api /repos/{owner}/{repo}/pulls/{pr}/comments` |
| CI workflow definitions | `.github/workflows/*.yml` | File read (for gate discovery) |

| Output | Condition |
|--------|-----------|
| ONE commit pushed to PR branch | Every cycle that produces actionable changes |
| Canonical replies to ALL review threads | Every cycle, after push |
| Batch summary comment on PR | Every cycle, after replies |
| Deferred issues created | When findings are deferred |
| Convergence report | Final cycle |

## Authority Order

1. User request (PR number, repo, specific instructions).
2. CI failure logs (exact error output from the failing gate).
3. Review bot comments (Gemini, CodeRabbit, human reviewers).
4. Repo ground truth: `.github/workflows/*.yml`, `tsconfig.json`, `package.json`, lint configs.
5. This skill's references.
6. `Unknown` — do not invent fixes for unclear comments.

## Non-Negotiable Rules

1. **ONE commit, ONE push per cycle.** ALL fixes for a cycle MUST be batched into a single commit with a single push. Multiple pushes per cycle is a protocol violation.
2. **Local verify is a BLOCKING GATE.** MUST run ALL CI gate commands locally and confirm exit 0 before any push. If local verify fails, fix the failure BEFORE pushing — do NOT push and hope CI catches it.
3. **Gate discovery BEFORE fixing.** MUST parse ALL workflow YAML files to enumerate every CI gate command BEFORE applying any fixes. No surprises from unknown gates.
4. **Remote CI is confirmation, not discovery.** After push, CI polling confirms what local verify already proved. If CI finds something local verify missed, that's a protocol failure to document.
5. **Every thread gets a reply.** No silent fixes. Every review comment receives a canonical-format response and is resolved.
6. **Validation gates are mandatory.** Each workflow step produces a required artifact (see validation-gates.md). Cannot advance without the artifact.
7. **MUST NOT loop more than 3 cycles** (configurable via `max_cycles`).
8. **MUST NOT fix comments marked as "discussion" or "question"** without user confirmation.
9. **MUST NOT force-push or rewrite history** on the PR branch.
10. **MUST preserve existing PR description and metadata.**
11. **MUST label deferred items explicitly with reason and linked issue.**
12. **When parallel CI jobs fail independently**, use parallel triage (one fix per job, still batched into one commit).
13. **When review comments conflict with CI requirements**, CI wins (it blocks merge).

## Compact Workflow

1. **Identify PR** — get PR number, repo, branch from user or context.
2. **Discover CI gates** — read ALL `.github/workflows/*.yml` files. Extract every `run:` command that can fail. Build the local verify command list. → **Produce Gate A artifact.**
3. **Ingest signals** — load [references/signal-ingestion.md](references/signal-ingestion.md).
   - Fetch CI run status and failed logs.
   - Fetch all unresolved review comments and inline suggestions.
4. **Classify findings** — load [references/finding-classifier.md](references/finding-classifier.md).
   - Route CI failures by type (lint, type-check, test, build, security).
   - Route review comments by actionability (actionable, discussion, deferred).
   - → **Produce Gate B artifact.**
5. **Apply ALL fixes** — load [references/fix-engine.md](references/fix-engine.md).
   - Fix ALL blocking items (CI failures).
   - Fix ALL actionable review comments.
   - Skip discussion-only and deferred items.
   - Do NOT commit or push yet.
   - → **Produce Gate C artifact** (git diff --stat).
6. **Local verify (BLOCKING GATE)** — run EVERY CI gate command locally.
   - If ANY gate fails → fix it immediately, re-run ALL gates.
   - Repeat until ALL gates pass locally (max 5 iterations).
   - Only proceed to step 7 when local verify is fully green.
   - → **Produce Gate D artifact** (all exit codes = 0).
7. **Commit and push (ONCE)** — single commit with conventional message, single push.
   - → **Produce Gate E artifact** (commit SHA, push count = 1).
8. **Reply to review threads** — load [references/review-replies.md](references/review-replies.md).
   - Reply to every thread using canonical format (Fixed/Deferred/Acknowledged/Disagreed).
   - Create issues for deferred items.
   - Resolve all threads.
   - Post batch summary comment.
   - → **Produce Gate F artifact** (reply count, resolved count).
9. **Wait and confirm** — load [references/convergence-loop.md](references/convergence-loop.md).
   - Wait for CI to complete (poll `gh run list` on the branch).
   - CI should pass (local verify already confirmed). If it fails, investigate the delta.
   - Check for new review comments posted after push.
   - If new actionable signals exist → loop back to step 3.
   - If CI green AND no new actionable comments → converge.
10. **Report** — emit convergence block and deferred items list.

## Resource Map

- [references/signal-ingestion.md](references/signal-ingestion.md) — how to fetch and parse CI logs + review comments + workflow YAML.
- [references/finding-classifier.md](references/finding-classifier.md) — classification rules for routing signals to fix strategies.
- [references/fix-engine.md](references/fix-engine.md) — fix methodology per finding type, local verification protocol, batch discipline.
- [references/review-replies.md](references/review-replies.md) — canonical reply formats, thread resolution, batch summary, downstream leverage.
- [references/convergence-loop.md](references/convergence-loop.md) — wait, poll, re-check, and convergence gate logic.
- [references/validation-gates.md](references/validation-gates.md) — enforcement layer with required artifacts at each step.

## Validation

Before declaring convergence:
- CI status MUST be `success` on latest commit.
- No new unresolved review comments posted after last push.
- All review threads replied to and resolved.
- All actionable findings from initial ingestion addressed or explicitly deferred.
- All deferred items have linked issues.
- All 6 gate artifacts produced for the final cycle.
- Convergence block emitted with all required fields.

## Failure Handling

- CI logs unavailable → STOP; ask user for run ID or paste logs.
- Review API rate-limited → wait 60s, retry once, then STOP.
- Fix causes new CI failure → revert that fix, mark as deferred, continue.
- Local verify passes but remote CI fails → investigate environment delta, document, defer if unresolvable.
- Thread resolution API fails → log, continue (non-blocking for merge).
- Max cycles reached without convergence → emit `partial` status with remaining items.
- Conflicting review comments → mark as deferred, ask user.
- Gate artifact cannot be produced → STOP at that gate, report `blocked`.
