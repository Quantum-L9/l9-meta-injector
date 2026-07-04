<!-- L9_META
l9_schema: 1
parent: l9-toth-improvement
tags: [recursive, improvement, convergence, loop, passes]
status: active
/L9_META -->

# Recursive Improvement Loop

## Purpose
After the hybrid is constructed, run improvement passes until all convergence
criteria are met or max iterations are reached.

## Pass Structure

Each pass follows this pattern:
```
1. Identify the weakest point in the current hybrid
   (lowest-confidence element, open unknown, or unresolved anti-pattern)
2. Apply the single highest-leverage fix to that point
3. Record the improvement in the improvement log
4. Re-check all 5 convergence criteria
5. If all pass → CONVERGED → stop
   If any fail → increment pass counter → repeat
```

## Improvement Log Format
```
Pass N: <what was weak> → <fix applied> → <criteria affected>
Example:
Pass 1: Manifest step had no circular dep check → added circular dep scan
        → Criterion 3 (no open unknowns) partially resolved
Pass 2: RAFA contingency undefined → added fallback + trigger condition
        → Criterion 4 (RAFA) now PASS
```

## Convergence Criteria (all 5 must PASS)
See references/convergence-criteria.md for full verification methods.
Quick reference:
1. All 5 first-order gates PASS on hybrid
2. Confidence ≥ 0.90
3. No open unknowns
4. RAFA documented (primary + fallback + trigger)
5. Block 9 + Block 11 complete

## Max Iterations
Hard cap: 7 passes.
If not converged after pass 7:
  - Surface the blocking unknown or failing criterion explicitly
  - Halt; do not deliver a non-converged plan as if it were optimal
  - Escalate to human with: current confidence, failing criterion, specific blocker

## Diminishing Returns Detection
If the same criterion fails in pass N and pass N+1 with no improvement:
  - The improvement applied in pass N was insufficient
  - Try a different axis of fix (see branch-generation-protocol.md axes of variation)
  - If still blocked after two different attempts → label as Unknown; escalate

## Typical Convergence Pattern (from pack-consolidation session)
Pass 1: Add missing invariant (circular dep check)       → Criterion 3 improved
Pass 2: Add RAFA contingency                             → Criterion 4 resolved
Pass 3: Make domain resolver pluggable                   → Criterion 3 + Gate 2 improved
Pass 4: Add idempotent mode                              → Criterion 5 (Block 9) improved
Pass 5: Scope delta mode to diff list                    → Confidence crosses 0.90 → CONVERGED
5 passes is typical for Highly Complex tasks. Simple tasks may converge in 2–3.
