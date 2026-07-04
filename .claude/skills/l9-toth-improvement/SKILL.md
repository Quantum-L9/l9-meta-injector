---
name: l9-toth-improvement
description: >
  Structured reasoning skill for generating parallel improvement branches (ToTh),
  pruning dominated paths, constructing a hybrid-optimal solution, then recursively
  improving until convergence. Use for any high-stakes plan, architecture decision,
  or strategy that requires visible multi-path evaluation before commitment.
  Mirrors the exact methodology applied in the L9 pack-consolidation session.
skill_schema: 1
layer: control_plane
role: skill_entrypoint
tags: [l9, reasoning, ToTh, branch-pruning, hybrid, convergence, improvement, planning]
owner: igor_beylin
status: active
version: 1.0.0
updated: 2026-06-20
sources:
  - l9-structured-reasoning (parent skill)
  - confidence-and-contingency.md
  - best-of-n-parallel.md
  - reasoning-modes.md
  - first-order-gates.md
  - reasoning-protocol.md (Blocks 0–9)
  - Kernel-First-Order-Thinking-Domain-Agnostic
  - Reasoning_Think_Strategy_v1.1
---

# L9 ToTh Improvement Skill

## Purpose
Apply Tree-of-Thought multi-branch reasoning, score and prune branches via ADI,
construct a hybrid optimal path, then recursively improve until all convergence
criteria are met. Produces a fully traceable reasoning artifact with confidence
score, improvement log, and RAFA contingency.

## When to Use
- High-stakes plan review where a single path may have blind spots
- Architecture decisions requiring ≥2 alternatives before commitment
- Any plan where "just try it" is too costly and parallel evaluation adds leverage
- Post-plan improvement loops where convergence isn't yet reached

## When NOT to Use
- Trivial one-line fixes with no trade-offs (use Rapid mode instead)
- Already-converged plans with confidence ≥ 0.91 and no open unknowns
- Time-critical crisis response (use Rapid → B1 → B4 → B7 abbreviated flow)

## Core Contract

| Phase | Step | What Happens | Output |
|-------|------|--------------|--------|
| 0 | Preflight | 5 first-order gates on the input plan | Gate pass/fail list |
| 1 | Complexity score | Numeric routing to depth tier | Tier + ADI config |
| 2 | Branch generation | Generate N distinct improvement paths | Branch specs |
| 3 | ADI scoring | Score each branch: Abductive + Deductive + Inductive | Confidence per branch |
| 4 | Prune | Eliminate dominated branches with explicit failure reason | PRUNED log |
| 5 | Hybrid construction | Extract best elements from survivors; construct hybrid | Hybrid spec |
| 6 | Recursive improvement | Run improvement passes until convergence | Improvement log |
| 7 | Convergence check | All 5 criteria met? If not, loop back to step 6 | Pass/fail |
| 8 | RAFA + Block 9 | Primary plan + fallback + trigger + implementation plan | Final artifact |
| 9 | Deliver | Confidence score, branch-scoring trace, hybrid plan, metrics | Tar/file output |

## Compact Workflow
```
Preflight → Score complexity → Generate branches → ADI-score each
→ Prune dominated → Construct hybrid → Recursive improve → Convergence check
→ RAFA contingency → Block 9 plan → Deliver with confidence
```

## Convergence Criteria (all 5 must pass)
1. All 5 first-order gates PASS on the final hybrid
2. Confidence ≥ 0.90 on the winning path
3. No open unknowns remaining (label Unknown + resolve or defer explicitly)
4. RAFA contingency documented (primary + fallback + trigger)
5. Block 9 implementation plan and Block 11 success metrics complete

## Authority Order
1. Explicit user instruction
2. Workspace invariants (AGENTS.md, INVARIANTS.md)
3. This skill + first-order-gates kernel
4. l9-structured-reasoning (parent)
5. Domain-specific skills loaded after this one

## Operating Rules
1. **Minimum 2 branches** — never evaluate a single path as if it were optimal.
2. **ADI on every branch** — Abductive + Deductive + Inductive; surface contradictions.
3. **Explicit prune reasons** — every pruned branch must state which ADI mode failed and why.
4. **Hybrid absorbs, not replaces** — extract the strongest element from each pruned branch
   before discarding it. Nothing is wasted.
5. **Recursive improvement is bounded** — max 7 passes; if not converged by pass 7, halt
   and surface the blocking unknown explicitly.
6. **Confidence is required** — state score on every branch and on the final hybrid.
7. **Visible reasoning** — no black-box conclusions; every pruning and absorption decision
   is traceable in branch-scoring.md.
8. **Fail closed** — if convergence criteria not met after max passes, halt and escalate.

## Failure Handling
- < 2 viable branches after pruning → trigger Block 8 (Stuck); generate new branch
  from a different reasoning axis (creative mode) before proceeding
- Confidence < 0.80 on best branch → do not deliver; re-run ADI with disconfirming evidence
- RAFA trigger condition undefined → block delivery until fallback is specified
- Block 9 cannot be filled without guessing → label gaps Unknown; halt step 6 until resolved

## Resource Map
- references/branch-generation-protocol.md  — how to generate diverse, non-overlapping branches
- references/adi-scoring-rubric.md          — scoring rubric per ADI mode
- references/prune-and-absorb-rules.md      — prune criteria + absorption extraction rules
- references/hybrid-construction-guide.md   — how to compose a hybrid from survivors
- references/recursive-improvement-loop.md  — pass structure, convergence check, max iterations
- references/convergence-criteria.md        — all 5 criteria with verification methods
- references/toth-trace-template.md         — fill-in template for branch-scoring.md output
- references/worked-example.md              — annotated replay of the pack-consolidation session
