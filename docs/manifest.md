# Pack Manifest — l9-consolidation v1.0.0

## Root
- SKILL.md             entrypoint, mode routing, resource map
- ARCHITECTURE.md      data flow, shared core, mode differences, B->C
- CONTRACTS.md         ingress, move_map, header schemas
- VALIDATION.md        all gates, stop conditions
- DECISION_LOG.md      all decisions with rationale
- UNKNOWN_REGISTER.md  unknowns, resolution paths
- TRACEABILITY_MAP.yaml
- ASSUMPTION_MAP.yaml
- ARTIFACT_MANIFEST.yaml
- CHANGE_SUMMARY.md
- MANIFEST.md

## schemas/
- move_map.schema.yaml
- l9_meta.schema.yaml
- l9_artifact_meta.schema.yaml

## core/ (shared, mode-neutral)
- ingress.py        single entry, validate + route
- scanner.py        recursive file walk
- hasher.py         sha256
- classifier.py     domain hints, artifact_type, confidence
- path_planner.py   proposed output paths
- dedup_gate.py     duplicate/collision detection

## modes/repo-pack/
- injector.py       L9_META in-place stamp (idempotent)

## modes/folder-artifact/
- injector.py       copy-only, B->C, L9_ARTIFACT_META + sidecars

## references/
- reasoning-link.md   pointer to l9-branch-merge-reasoning (external)
- worked-example.md   CLI examples for both modes
