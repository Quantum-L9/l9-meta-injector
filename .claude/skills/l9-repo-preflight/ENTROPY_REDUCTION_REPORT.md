# Entropy Reduction Report

## Removed

- Five superseded change logs
- Five superseded validation reports
- Two obsolete v3.2 hardening reports
- One stale v3.7 traceability report

## Consolidated

- Optional tool discovery now has one implementation.
- Environment capability reporting consumes the same tool records used by gates.
- Current change, validation, tree, manifest, and regression evidence now live in canonical top-level artifacts.

## Intentionally retained

- `v31.py`, `v32.py`, `v35.py`, `v36.py`, and `v37.py` remain tested compatibility entrypoints.
- Historical report schemas remain version-locked compatibility contracts exercised by regression tests.
- `docs/migration-notes.md` and `docs/defect-traceability.md` retain durable migration and defect history.
