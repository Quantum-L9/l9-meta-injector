<!-- L9_META
l9_schema: 1
parent: l9-toth-improvement
tags: [prune, absorb, hybrid, dominance]
status: active
/L9_META -->

# Prune and Absorb Rules

## Prune Conditions (eliminate branch)
A branch is PRUNED when any of these hold:
1. Any ADI mode is FAIL (hard) — not partial, not assumption-flagged, but outright fail
2. Confidence cap ≤ 0.68 after scoring
3. Branch is dominated: another branch achieves the same outcome with fewer costs/risks
4. Branch violates a first-order gate (e.g., polish-before-proof, cosmetic-only)
5. Branch creates anti-patterns explicitly listed in the active kernels

## Absorb Before Pruning (mandatory)
Before discarding a pruned branch, extract any element that is:
- Correct in isolation (even if the whole branch fails)
- Not present in surviving branches
- Reducible to a single atomic improvement

Absorb rule: one extracted element per pruned branch, integrated into the hybrid spec.
If no extractable element exists, document "nothing absorbed" explicitly.

## Absorption Examples (from pack-consolidation session)
- Branch A pruned (hash staleness): absorbed → simplified `resolve_domain()` fallback to "generic"
- Branch C pruned (inject-last): absorbed → dedup gate as annotation-only step (not a blocker)

## Dominance Test
Branch X dominates Branch Y when:
  X.confidence > Y.confidence  AND
  X achieves Y's outcome  AND
  X has fewer or equal unverified assumptions

If X dominates Y → prune Y; no absorption needed unless Y has unique correct element.

## Output Format
```
PRUNED: Branch <id> — "<name>"
  Reason: <which ADI mode failed and specific failure>
  Absorbed: "<element extracted>" → integrated into <hybrid component>
  OR
  Absorbed: nothing (branch was fully dominated with no unique correct element)
```
