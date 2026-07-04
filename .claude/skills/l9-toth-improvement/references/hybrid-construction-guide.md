<!-- L9_META
l9_schema: 1
parent: l9-toth-improvement
tags: [hybrid, construction, composition, synthesis]
status: active
/L9_META -->

# Hybrid Construction Guide

## What a Hybrid Is
A hybrid is NOT a compromise or average of branches.
It is the **highest-confidence path**, composed from:
1. The winning branch's core structure (primary backbone)
2. Absorbed elements from pruned branches (targeted additions)
3. Improvements surfaced during ADI that no individual branch captured

The hybrid must have HIGHER confidence than the winning branch alone,
because absorbed elements fill gaps that the winning branch had.

## Construction Steps

### Step 1 — Declare the backbone
State which branch provides the primary structure and why.
```
Backbone: Branch <id> — "<name>"
Reason: Highest ADI scores; core claim validated; no hard failures.
```

### Step 2 — Integrate absorbed elements
For each absorbed element (from prune-and-absorb-rules.md):
```
Absorbed from Branch <id>: "<element>"
Integration point: <where in the backbone this element attaches>
Effect: <what this adds to the backbone's capability or resilience>
```

### Step 3 — State what the hybrid does that no single branch did
```
Net-new capability (not in any individual branch):
  - <element 1>: emerged from combining X and Y
  - <element 2>: identified during ADI synthesis
```

### Step 4 — Re-score the hybrid
Run the confidence formula from adi-scoring-rubric.md on the hybrid as a whole.
Hybrid confidence should be ≥ winning branch confidence + 0.02 minimum.
If it isn't, re-examine what was absorbed — something is missing.

### Step 5 — First-order gate check on the hybrid
Run all 5 gates on the hybrid plan, not just on individual branches.
Gate 3 (dependency order) is especially important — absorbed elements may
introduce new sequencing constraints.

## Anti-patterns
- Hybrid that simply selects Branch B wholesale with no absorption → not a hybrid
- Hybrid that absorbs contradictory elements → surface the contradiction, resolve first
- Hybrid with lower confidence than winning branch → absorption introduced a regression; fix it
