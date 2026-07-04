---
name: l9-consolidation
description: >
  Unified consolidation playbook with shared core (scan/hash/classify/dedup/path-plan)
  and two mode adapters: repo-pack (L9_META, in-place stamping, catalog->delta) and
  folder-artifact (L9_ARTIFACT_META, copy-only, B->C pipeline, source immutable).
  Single ingress routes to the correct mode. Reasoning kernel is separate (l9-branch-merge-reasoning).
skill_schema: 1
layer: control_plane
role: skill_entrypoint
tags: [l9, consolidation, repo-pack, folder-artifact, meta-injection, b-then-c, single-ingress]
owner: igor_beylin
status: active
version: 1.0.0
updated: 2026-06-20
replaces:
  - l9-pack-consolidation (repo mode)
  - l9-folder-artifact-consolidation (folder mode)
references:
  reasoning_kernel: l9-branch-merge-reasoning
---

# L9 Consolidation Playbook

## Purpose
One playbook. Two modes. Shared core engine. Select the mode via the ingress
request; everything else is automatic.

## Mode Routing

| mode | target | header | mutation | pattern |
|---|---|---|---|---|
| repo-pack | git repo / code tree | L9_META | in-place stamping | catalog -> delta |
| folder-artifact | non-repo folder (Dropbox etc.) | L9_ARTIFACT_META | copy-only, source immutable | B (catalog) -> C (materialize) |

## Single Ingress

```yaml
action: consolidate
mode: repo-pack | folder-artifact
inputs:
  source: "<path>"
  output: "<path>"            # folder-artifact only; ignored for repo-pack
constraints:
  source_mutation: bool       # must be false for folder-artifact
  dry_run: bool
  confidence_threshold: 0.60  # rows below threshold -> 99_CONFLICTS_AND_UNKNOWN/
trace_id: "<uuid>"
```

## Compact Workflow

```text
ingress (validate + route)
  -> core/scanner -> core/hasher -> core/classifier -> core/path_planner -> core/dedup_gate
  -> manifest gate
  -> modes/<mode>/injector (repo-pack: stamp in place | folder-artifact: copy + header/sidecar)
  -> reporting
```

## Shared Core (both modes)
- core/scanner.py     — recursive file walk, skip hidden/system
- core/hasher.py      — sha256 per file
- core/classifier.py  — domain hints, artifact type, confidence
- core/path_planner.py — proposed output paths from manifest rows
- core/dedup_gate.py  — detect duplicates + collisions by hash

## Mode Adapters
- modes/repo-pack/injector.py     — L9_META header, in-place, catalog/delta idempotent
- modes/folder-artifact/injector.py — copy to output, L9_ARTIFACT_META or .l9meta.yaml sidecar

## Reasoning Kernel (separate layer)
Branch sequencing decisions (B->C, merge-before-prune, dependency ordering) live in
l9-branch-merge-reasoning, not here. This pack executes; that skill reasons.
Reference: references/reasoning-link.md

## Resource Map
- core/               shared engine
- modes/repo-pack/    L9_META stamping adapter
- modes/folder-artifact/ copy + inject adapter
- schemas/            move_map, L9_META, L9_ARTIFACT_META
- references/         worked example, branch-merge link
- ARCHITECTURE.md     full data flow
- CONTRACTS.md        ingress + manifest contracts
- VALIDATION.md       all gates, pass/fail/Unknown
- DECISION_LOG.md     all decisions with rationale
