# Validation

All gates report PASS / FAIL / SKIPPED / Unknown. No fake validation.

## Gate 0 — Ingress
- [ ] mode is repo-pack or folder-artifact
- [ ] source exists and is readable
- [ ] folder-artifact: output != source and output not nested in source
- [ ] folder-artifact: source_mutation == false
- [ ] trace_id assigned

## Gate 1 — Scan Completeness
- [ ] Every non-hidden file in source tree appears in inventory.csv
- [ ] Every row has content_hash

## Gate 2 — Manifest (before any write)
- [ ] move_map.csv parses against schemas/move_map.schema.yaml
- [ ] No empty source_path, content_hash, or output_path
- [ ] No unresolved collisions

## Gate 3 — Injection (repo-pack)
- [ ] Already-stamped files skipped (idempotent)
- [ ] Source file count unchanged after run

## Gate 3 — Copy + Injection (folder-artifact)
- [ ] Output file count == eligible move_map rows
- [ ] Each copied file hash matches source hash
- [ ] Source folder mtime + byte count unchanged

## Gate 4 — Reporting
- [ ] CHANGE_SUMMARY.md written
- [ ] dedup_report.csv written
- [ ] VALIDATION_LOG.md written with honest pass/fail per gate

## Stop Conditions
- source_mutation true on folder-artifact -> HALT
- Manifest gate fails -> HALT before any write
- Output nested inside source -> HALT
