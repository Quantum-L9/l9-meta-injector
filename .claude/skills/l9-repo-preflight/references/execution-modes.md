# Execution Modes

- `filesystem`: local recursive evidence; Git and commands remain separately detected.
- `connector`: remote or selected-file evidence; never claims authoritative local Git state or write success.
- `deterministic`: Gate 20A only.
- `reasoning_enriched`: validated Gate 20B response attached to the deterministic result.
- `pr_contextual`: verified Gate 20C PR evidence attached.

Read-only execution cannot emit successful remediation receipts. Provider absence preserves deterministic output.
