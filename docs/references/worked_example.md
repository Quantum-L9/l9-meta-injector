# Worked Example — Unified Mode Run

## repo-pack mode
```bash
python core/ingress.py \
  --mode repo-pack \
  --source ./my-repo \
  --dry-run false
# -> scans, classifies, stamps L9_META headers in-place (idempotent)
```

## folder-artifact mode (B then C)
```bash
# Phase B — catalog (read-only)
python core/ingress.py \
  --mode folder-artifact \
  --source "$HOME/Dropbox/L9 Constellation - NODES" \
  --output "$HOME/Dropbox/L9 Constellation - NODES__organized_$(date +%Y%m%d_%H%M)" \
  --phase B --dry-run false

# Review: 00_MANIFESTS/inventory.csv, move_map.csv, conflicts.md
# Then run Phase C:

python core/ingress.py \
  --mode folder-artifact \
  --from-manifest "00_MANIFESTS/move_map.csv" \
  --phase C --copy-files true --inject-headers true
```

## Why B then C (not B vs C)
B emits move_map.csv. C consumes it.
Without B, C must re-scan and re-classify on every run — expensive and non-deterministic.
With B, C is a thin executor: one row = one copy + inject. No logic, no guessing.
This is the catalog/delta pattern applied to copy-only materialization.
