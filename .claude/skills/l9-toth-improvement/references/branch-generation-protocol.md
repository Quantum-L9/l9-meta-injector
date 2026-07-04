<!-- L9_META
l9_schema: 1
parent: l9-toth-improvement
tags: [branch, generation, diversity, ToTh]
status: active
/L9_META -->

# Branch Generation Protocol

## Goal
Generate N branches that are *genuinely distinct* — different axes of variation,
not the same idea with minor parameter tweaks.

## Minimum Branch Count
| Complexity tier | Min branches | Recommended |
|-----------------|-------------|-------------|
| Simple | 1 (skip ToTh) | — |
| Moderate | 2 | 2–3 |
| Complex | 2 | 3 |
| Highly complex | 3 | 3–4 |

## Axes of Variation (pick different axes per branch)
Use these axes to ensure branches are structurally distinct, not just parameterically:

| Axis | Example variation |
|------|------------------|
| Sequencing | Do X before Y vs. Y before X |
| Coupling | Tight integration vs. loose composition |
| Scope | Full solution now vs. thin slice first |
| Ownership | New component vs. extend existing |
| Trust boundary | Validate early vs. validate late |
| Reversibility | Destructive/replace vs. additive/non-breaking |
| Delegation | Agent handles vs. human gate |
| Data flow | Push vs. pull vs. event-driven |

## Anti-patterns (MUST NOT)
- Two branches that differ only in naming or file count
- A branch that is clearly dominated before ADI runs (still generate it — document why it fails)
- Fewer than 2 branches on moderate+ complexity tasks
- Generating branches after a path is already committed to

## Branch Spec Format
Each branch must declare:
```yaml
branch_id: A | B | C | ...
name: "<short descriptive name>"
axis_of_variation: "<which axis makes this distinct>"
core_claim: "<one sentence: what does this path bet on being true?>"
key_moves:
  - "<concrete step 1>"
  - "<concrete step 2>"
strengths: []
weaknesses: []
adi_result:
  abductive: pass | fail | partial
  deductive: pass | fail | partial
  inductive: pass | fail | partial
confidence: 0.00
decision: SELECTED | PRUNED | ABSORBED
prune_reason: "<if PRUNED: which ADI mode failed and why>"
absorbed_into: "<if ABSORBED: which element was extracted and where it went>"
```
