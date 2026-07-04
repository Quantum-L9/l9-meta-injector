# Reasoning Kernel Reference

This pack (l9-consolidation) is the execution engine.
Branch sequencing, merge-before-prune, and dependency ordering reasoning lives in:

  l9-branch-merge-reasoning (separate skill, separate layer)

Key principle that governs this pack's B->C design:
  B and C are sequential phases (B unlocks C), not rival branches.
  B (catalog) produces move_map.csv.
  The manifest gate validates it.
  C (materialize) consumes it deterministically.
  Pruning B to "select C" destroys the leverage that makes C cheap.

Load l9-branch-merge-reasoning when you need to reason about new branch decisions.
Do not embed reasoning kernel logic here.
