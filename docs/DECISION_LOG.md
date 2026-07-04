# Decision Log

| # | Decision | Rationale |
|---|---|---|
| 1 | Merge repo-pack + folder-artifact into one playbook | ~80% shared core; two packs = two drifting scanners/dedup engines. Max leverage = shared core + adapters |
| 2 | Single ingress routes to mode | Normalize/validate/trace once; no module bypass |
| 3 | B -> C sequential, not rival branches | B unlocks C (catalog/delta precedent); pruning B destroys leverage. Gate 3 dependency check |
| 4 | Manifest gate between phases | C only acts on validated rows; makes C deterministic |
| 5 | Copy-only for folder-artifact | User constraint: source never mutated |
| 6 | In-place idempotent for repo-pack | Catalog/delta: re-run skips stamped files |
| 7 | Reasoning kernel stays separate | Execution pack != reasoning layer; merging them recreates layer-mixing |
| 8 | Sidecars for binary/non-text | Cannot inject comment headers into non-text formats |
| 9 | Unknown bucket for low confidence | No invented domain facts; label Unknown |
