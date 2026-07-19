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
| 10 | TypeScript pipeline is the single authoritative engine; Python `tools/consolidation/` is secondary/out-of-scope | Two injection engines with divergent header dialects (finding ACA-001) invite drift. The TS pipeline is what `package.json` ships (`main: dist/index.js`), what CI gates (`ci.yml` → `smoke`), and what the tests + selfpack exercise; the Python tool is wired into none of these. Declaring one authoritative — rather than maintaining both in lockstep — removes the drift surface. New work and the header-dialect contract target TS; the Python tool is retained for reference only. See `architecture.md` → Engine authority and `tools/consolidation/README.md`. |
