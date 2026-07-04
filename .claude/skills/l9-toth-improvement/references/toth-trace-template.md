<!-- L9_META
l9_schema: 1
parent: l9-toth-improvement
tags: [ToTh, template, trace, branch-scoring]
status: active
/L9_META -->

# ToTh Trace Template

Fill this for every ToTh improvement run. This becomes branch-scoring.md in the output.

---

## Header
```
Task: <what plan or decision is being evaluated>
Skill: l9-toth-improvement v1.0.0
Mode: <Rapid | Moderate | Deep>
Complexity Score: <N> (<Simple|Moderate|Complex|Highly Complex>)
ADI: <Full | Deductive+Abductive | Deductive only>
Required branches: <N>
Convergence target: confidence ≥ 0.90, all 5 criteria PASS
```

---

## Branch Specs (one block per branch)

```
## Branch <ID> — <Name> (<SELECTED | PRUNED | ABSORBED>)
Axis of variation: <which axis makes this distinct>
Core claim: <one sentence>
Key moves:
  1. <step>
  2. <step>
Confidence: 0.XX

ADI:
  Abductive: PASS | FAIL | PARTIAL — <one-line finding>
  Deductive: PASS | FAIL | PARTIAL — <one-line finding>
  Inductive: PASS | FAIL | PARTIAL — <one-line finding>

Decision: SELECTED | PRUNED
Prune reason: <if PRUNED: ADI mode that failed + specific failure>
Absorbed: <element extracted> → integrated into <hybrid component>
         OR: nothing (fully dominated)
```

---

## Hybrid Construction

```
Backbone: Branch <ID> — <reason>

Absorbed from Branch <ID>: <element> → <integration point> → <effect>
Absorbed from Branch <ID>: <element> → <integration point> → <effect>

Net-new (not in any individual branch):
  - <element>: <how it emerged>

Pre-absorption confidence (Branch <backbone_id>): 0.XX
Post-absorption confidence (hybrid): 0.XX
First-order gate check: PASS | FAIL (gate N: <reason>)
```

---

## Recursive Improvement Log

```
Pass 1: <weak point> → <fix> → <criteria affected>
Pass 2: <weak point> → <fix> → <criteria affected>
...
```

---

## Convergence Declaration

```
CONVERGED at Pass N.
Confidence: 0.XX (<label>)
All 5 criteria: PASS
Deferred unknowns: none | <list>
Decision: Proceed | Proceed with monitoring | Validate first
```
