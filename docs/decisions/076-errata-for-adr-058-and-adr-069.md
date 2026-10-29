# ADR-076: Errata for ADR-058 (deleted out-of-scope records) and ADR-069 (README rows)

## Status

Accepted

Amends [ADR-058](058-scoped-governed-runs-and-canonical-metadata-index-ordering-validation.md)
(Consequences, second bullet) and
[ADR-069](069-direct-cli-argument-strictness-and-apply-fail-on-issues.md) (Consequences,
last bullet). Errata only: no behaviour changes, and both decisions stand as adopted.

## Date

2026-10-29

## Context

Two accepted ADRs contain a sentence that does not match the repository at `ebc0dd3`.
Accepted ADR bodies are not rewritten, so the corrections are recorded here and linked
from each ADR's status.

### ADR-058: records of deleted out-of-scope files

ADR-058 Consequences states: “Records of out-of-scope files that were deleted or became
binary persist until an unscoped run reconciles them.” The code does not keep the
records of deleted files:

- `scopeFilteredPaths` (`src/carrier_operation.ts`) collects the paths the run's own
  discovery ledger recorded as `glob_filtered` or `extension_filtered`, and
  `readScopedIndexBase` carries forward only existing index records whose path is in
  that set. This is ADR-058 Decision item 1 (“exactly the records whose path the ledger
  marked scope-filtered”).
- A deleted file is not walked, so it has no ledger entry and its record is not carried
  forward. A file that now lands on a disposition decided before the scope test in
  `discoverFiles` (`src/retrieval.ts`: `generated_artifact`, `omitted`,
  `hidden_control`) is likewise not carried forward.
- The scope test is path-only and precedes content probing (`known_binary`,
  `binary_detected`), so an out-of-scope file that became binary is still
  `glob_filtered` or `extension_filtered`, and its old record is carried forward.

Reproduced against the built package at `ebc0dd3`: after an unscoped apply indexed
`docs/a.md`, `other/b.md` and `other/c.md`, `other/b.md` was deleted and `other/c.md`
overwritten with binary bytes; an apply scoped to `docs/**/*.md` passed and left the
index holding `docs/a.md` and `other/c.md`.

### ADR-069: README input-table rows

ADR-069 Consequences states that the README input-table rows for `dry-run` /
`fail-on-issues` “still describe the legacy `pipeline` preview with
`fail-on-issues: "false"`; they must be refreshed with this decision”. Commit `e17bd34`
refreshed both rows: `README.md` now documents `dry-run` as an exact boolean that
`check` rejects as `false` and `apply` rejects as `true`, and `fail-on-issues` as an
exact boolean accepting only `true`, with `"false"` an input error in every mode
including `apply` (ADR-069).

## Options Considered

### Option A: Errata ADR plus “Amended by” lines (adopted)

- Pros: accepted ADR bodies stay unchanged; readers of either ADR find the correction
  from its status.
- Cons: the uncorrected sentence remains in the ADR body.

### Option B: Edit the sentences in place

- Cons: rewrites accepted ADR bodies, which this repository does not do.

## Decision

1. ADR-058 Consequences, second bullet, reads as corrected: a scoped run carries forward
   only the records of files its discovery ledger marked `glob_filtered` or
   `extension_filtered`. The record of an out-of-scope file that was deleted, or that
   now resolves to a disposition decided before the scope test, is dropped by the
   scoped run. The record of an out-of-scope file that became binary is carried forward
   unchanged until an unscoped run reconciles it. Only an unscoped run guarantees
   ADR-025 completeness, as ADR-058 already states.
2. ADR-069's README obligation is discharged by `e17bd34`; the sentence is historical.

## Consequences

- No code, test or persisted format changes.
- An operator relying on a scoped apply to keep the record of a deleted out-of-scope
  file loses that record; this was already the shipped behaviour.
