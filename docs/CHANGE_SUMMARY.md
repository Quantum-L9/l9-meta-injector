# Change Summary

## Merged into this pack
- l9-pack-consolidation (repo-pack mode, L9_META, in-place)
- l9-folder-artifact-consolidation (folder-artifact mode, copy-only, B->C)

## Shared core extracted
- scanner, hasher, classifier, path_planner, dedup_gate
  (previously duplicated across both packs)

## Architecture correction embedded
- B and C are sequential phases (B unlocks C), not rival branches.
- Manifest gate enforces the dependency.
- C is a thin executor: one move_map row = one copy + inject operation.

## Reasoning kernel kept separate
- l9-branch-merge-reasoning referenced, not embedded.
