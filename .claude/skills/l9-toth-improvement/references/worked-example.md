<!-- L9_META
l9_schema: 1
parent: l9-toth-improvement
tags: [worked-example, pack-consolidation, session-replay, annotated]
status: active
/L9_META -->

# Worked Example — Pack Consolidation Session (2026-06-20)

Annotated replay of the exact methodology applied during the L9 pack-consolidation
strategy session. Use as a reference for how the skill operates in practice.

---

## Task
Design a pack-agnostic workflow for consolidating zip packs into a single repo,
leveraging l9metainjector, repo-structure-normalizer, and pack_execution_guide.

## Complexity Score
6 files affected (+5) + 4 integrations (+8) + 2 unknowns (+2) + high-risk (+4) = 19
Tier: Highly Complex → Full block protocol + ADI + ToTh (≥2 branches required)

---

## Branch Generation

Three axes used:
- Branch A: Sequencing (single-pass vs. multi-pass inject)
- Branch B: Sequencing + Data flow (two-pass inject, manifest as side-output)
- Branch C: Trust boundary (inject last as finalization stamp)

These are structurally distinct — not the same idea with minor variations.

---

## Branch A — Header-First Flat Injector (PRUNED)

Axis: Sequencing — single catalog inject pass, no delta re-stamp
Core claim: One inject pass is sufficient; normalize happens after headers exist
Confidence: 0.71

ADI:
  Abductive: PASS — header-first pattern is valid; catalog before transform is sound
  Deductive: FAIL — after normalize mutates files, content_hash in manifest is stale;
             hash contract violated; manifest cannot be trusted for dedup
  Inductive: PARTIAL — works for packs that don't change files during normalize;
             fails to generalize to AI-dump packs that split files

Prune reason: Deductive FAIL on hash contract — this is a hard invariant violation.
Absorbed: simplified resolve_domain() fallback to "generic" (correct in isolation)
         → integrated into Branch B's domain resolver design

---

## Branch B — Two-Pass Injector: Catalog + Delta (SELECTED → WINNER)

Axis: Sequencing + Data flow — catalog pass before normalize, delta pass after
Core claim: Two-pass preserves hash accuracy across the full pipeline; manifest is always current
Confidence: 0.91

ADI:
  Abductive: PASS — matches content-addressable system pattern (git, Nix, Docker layers):
             label before transform, re-label only what changed
  Deductive: PASS — catalog pass runs on unmodified files (hashes accurate);
             delta pass runs on post-normalize diff (hashes refreshed only where needed);
             no step violates the hash contract
  Inductive: PASS — idempotent mode enables re-runs; delta scoped to diff list scales
             to arbitrarily large packs; resolve_domain() fallback generalizes to any domain

Decision: SELECTED
Pre-absorption confidence: 0.83
Post-absorption confidence (after absorbing A's fallback + C's annotation rule): 0.91

---

## Branch C — Manifest-First, Inject Last (PRUNED)

Axis: Trust boundary — treat inject as finalization stamp after all decisions are made
Core claim: Headers are metadata; they should arrive last as a clean final annotation
Confidence: 0.68

ADI:
  Abductive: FAIL — no causal model for metadata arriving last; "finalization stamp"
             metaphor doesn't hold when metadata is needed for dedup decisions;
             annotation-last is the polish-before-proof anti-pattern
  Deductive: PARTIAL — logically consistent IF dedup doesn't need header data;
             but dedup DOES need hash/domain metadata, so dedup must re-derive it separately
  Inductive: FAIL — creates a parallel scan (file scan for dedup + inject for headers)
             that generalizes into two separate inventory systems; coupling drag

Prune reason: Abductive FAIL (inject-last anti-pattern) + Inductive FAIL (duplicate scan)
Absorbed: dedup gate as annotation-only step (not a blocker)
         → integrated into Branch B as Step 5 behavior rule: "ANNOTATE only, 3-LLM resolves"

---

## Hybrid Construction

Backbone: Branch B — highest ADI scores; no hard failures; two-pass preserves hash invariant

Absorbed from Branch A: simplified resolve_domain() fallback → domain resolver design
  Effect: domain resolver requires zero injector code changes for new domains

Absorbed from Branch C: dedup gate as annotation-only → Step 5 behavior rule
  Effect: consolidation never blocks on conflicts; 3-LLM review handles resolution

Net-new (not in any individual branch):
  - Idempotent mode: emerged during ADI synthesis (deductive check on re-runs)
  - Pluggable domain_hints in skill.yaml: emerged from absorption of Branch A's fallback
  - Cross-pack dedup (final pass after all packs): emerged from inductive generalization

Pre-absorption confidence (Branch B alone): 0.83
Post-absorption confidence (hybrid): 0.91
First-order gate check: all 5 PASS

---

## Recursive Improvement Log

Pass 1: Manifest step had no circular dep check (analysis-modes invariant)
        → added circular dep scan to dedup_gate.py
        → Criterion 3 (no open unknowns) improved

Pass 2: RAFA contingency undefined (high-stakes plan requirement)
        → added fallback (manual_catalog.py) + trigger condition
        → Criterion 4 (RAFA) now PASS

Pass 3: Domain resolver hardcoded domain strings (anti-pattern: building new vs reusing)
        → made domain_hints pluggable via skill.yaml
        → Criterion 2 (confidence) +0.03; Gate 2 (effort/coverage) improved

Pass 4: Catalog pass could double-inject on re-runs (fragility)
        → added idempotent mode (skip if valid header exists)
        → Criterion 5 (Block 9 rollback) improved

Pass 5: Delta mode walked full pack unnecessarily for large packs
        → scoped delta to explicit changed-files list
        → Confidence crosses 0.90 → all 5 criteria PASS

---

## Convergence Declaration

CONVERGED at Pass 5.
Confidence: 0.91 (Very High)
All 5 criteria: PASS
Deferred unknowns: none
Decision: Proceed
