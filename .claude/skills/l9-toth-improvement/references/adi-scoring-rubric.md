<!-- L9_META
l9_schema: 1
parent: l9-toth-improvement
tags: [ADI, scoring, abductive, deductive, inductive]
status: active
/L9_META -->

# ADI Scoring Rubric

Run all three modes on every branch. Surface contradictions between modes —
do not silently discard a conflicting result.

## Abductive — Pattern Discovery
Question: "What pattern or mechanism does this branch bet on?"
Pass: Branch rests on a recognizable, validated pattern (analogous system, prior art, known principle)
Fail: Branch assumes a pattern that doesn't hold in the problem context
Partial: Pattern exists but hasn't been verified in this specific domain

Scoring guide:
- Strong analogy to validated system → +0.10 to confidence
- Novel mechanism with no analogues → neutral (not a fail, but flag)
- Mechanism that contradicts known behavior in this domain → FAIL

## Deductive — Logical Validation
Question: "Given the premises of this branch, does the conclusion follow?"
Pass: Every step in the branch is logically consistent; no step breaks a known invariant
Fail: A step violates a stated constraint, contract, or invariant
Partial: Logic holds under current assumptions, but an unverified assumption could break it

Scoring guide:
- All invariants preserved, no contract violations → +0.10
- One unverified assumption in critical path → flag; do not fail immediately
- Explicit contract violation → FAIL (hard)

## Inductive — Generalization
Question: "Does this branch scale, generalize, and avoid special-casing?"
Pass: Branch produces reusable, extensible output; works for N=1 and N=many
Fail: Branch works only for the specific case; creates tech debt or coupling
Partial: Works now, but requires future refactor to generalize

Scoring guide:
- Naturally extensible (plug-in pattern, config-driven, generic) → +0.05
- Works for the current case only → neutral
- Creates coupling that actively prevents future extension → partial fail

## Confidence Calculation
```
base = 0.70 (starting point for any viable branch)
+ abductive_bonus (0.00–0.10)
+ deductive_bonus (0.00–0.10)
+ inductive_bonus (0.00–0.05)
- per_partial_penalty (0.05 per partial)
- per_assumption_penalty (0.03 per unverified critical assumption)
= raw_confidence

If any ADI mode is FAIL (hard): cap confidence at 0.68 → route to PRUNED
If confidence < 0.80 on best branch: do not deliver; re-run with disconfirming evidence
```

## When ADI Modes Contradict
Abductive PASS + Deductive FAIL → branch has a good intuition but a logic error; fix the logic
Deductive PASS + Abductive FAIL → branch is internally consistent but bets on a bad pattern; reframe
Inductive FAIL + others PASS → branch is correct but not scalable; absorb its correct element into a hybrid
All three FAIL → branch is dominated; prune; do not absorb
