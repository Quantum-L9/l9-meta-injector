# Architecture

## Layers

```
ingress.py (single entry, validates + routes)
         |
    core/ (shared, mode-neutral)
    scanner -> hasher -> classifier -> path_planner -> dedup_gate
         |
    manifest gate (validates move_map.csv before any write)
         |
    modes/<mode>/injector.py
    repo-pack:       in-place L9_META stamp (idempotent, catalog/delta)
    folder-artifact: copy to output dir, inject L9_ARTIFACT_META or sidecar
         |
    reporting (CHANGE_SUMMARY.md, dedup_report.csv, VALIDATION_LOG.md)
```

## Shared Core Logic

| Module | Responsibility |
|---|---|
| scanner.py | Walk source, skip hidden/system, emit (rel_path, abs_path, ext) |
| hasher.py | SHA-256 per file; basis for dedup and idempotency |
| classifier.py | Infer artifact_type, domain, node_name, confidence from path+content |
| path_planner.py | Map each file to proposed output_path from domain hints |
| dedup_gate.py | Detect duplicate hashes and output_path collisions |

## Mode Differences (adapters only)

| Concern | repo-pack | folder-artifact |
|---|---|---|
| Source mutation | Allowed (stamp in-place) | Never (copy-only) |
| Header dialect | L9_META | L9_ARTIFACT_META |
| Binary/unsupported | Skip or warn | .l9meta.yaml sidecar |
| Idempotency | Re-run skips already-stamped files | Re-run to new output dir |
| Output location | Same tree | New sibling folder |

## B -> C Sequencing (folder-artifact)
B (catalog, read-only) produces move_map.csv.
The manifest gate validates it.
C (materialize) consumes move_map.csv row-by-row.
C never re-scans, never re-classifies. One row = one copy operation.
This is the same catalog/delta pattern as repo-pack, adapted for copy-only.

## Separation of Concerns
This pack = execution engine.
Branch sequencing reasoning = l9-branch-merge-reasoning (separate skill, referenced only).
