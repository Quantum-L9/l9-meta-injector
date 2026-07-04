<!-- L9_META
l9_schema: 1
parent: l9-toth-improvement
tags: [convergence, criteria, verification, acceptance]
status: active
/L9_META -->

# Convergence Criteria

All 5 must PASS before a hybrid plan is considered converged and deliverable.

## Criterion 1 — First-Order Gates
All 5 gates from first-order-gates.md pass on the HYBRID plan (not just individual branches).
Verification: re-run 30-second preflight on hybrid spec; all gates explicit pass.
Fail signal: any gate returns fail or partial → improvement pass required.

## Criterion 2 — Confidence ≥ 0.90
Hybrid confidence score (from adi-scoring-rubric.md formula) ≥ 0.90 (Very High).
Below 0.90: re-run ADI on weakest element; apply targeted fix.
Below 0.80: do not deliver; escalate.
Verification: state score explicitly in branch-scoring.md final section.

## Criterion 3 — No Open Unknowns
Every Unknown item from Block 2 (Context) and Block 3 (Decompose) is either:
  a) Resolved with evidence
  b) Explicitly deferred with a stated trigger for resolution
  c) Labeled as out-of-scope with justification
Verification: scan reasoning trace for "Unknown" labels; each one has a disposition.
Fail signal: any Unknown without a disposition → improvement pass required.

## Criterion 4 — RAFA Documented
Primary plan + fallback plan + trigger condition all specified.
Fallback must be actionable without the primary path being available.
Trigger must be specific (time-based, event-based, or failure-condition-based).
Verification: rafa-contingency.md exists and all three fields are non-empty.

## Criterion 5 — Block 9 + Block 11 Complete
Implementation plan (Block 9): critical path, files modified/created/deleted,
rollback plan, testing strategy, deployment order.
Success metrics (Block 11): 3–5 measurable criteria, each with named verification method.
Verification: implementation-plan.yaml and success-metrics.yaml are non-empty
and contain no "Unknown" or placeholder values.

## Convergence Declaration Format
```
CONVERGED at Pass N.
Confidence: 0.XX (Very High | High)
All 5 criteria: PASS
Blocking unknown at convergence: none | <description if deferred>
Recommended action: Proceed | Proceed with monitoring | Validate first
```
