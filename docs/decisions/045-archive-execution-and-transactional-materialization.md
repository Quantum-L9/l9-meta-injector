# ADR-045: Archive execution shares one run context and materializes transactionally

## Status

Accepted

## Date

2026-09-01

## Context

The main convergence contract `l9-meta-injector-main-convergence-v1` found that
archive safety had converged at the parser/preflight layer but not at the full
execution layer. The remaining failure family included validation evidence that
could miss a second dirty edit, ambiguous EOCD framing, per-archive session
budgets, live-path TOCTOU between admission and extraction, destructive
in-place refresh, weak ownership provenance, and dry-run verdict drift.

## Decision

Archive execution has one authority chain:

```text
live ZIP
  -> immutable tool-owned staged snapshot + SHA-256
  -> ArchiveExecutionResolution (one per acquisition)
       -> validated LocalArchivePolicy
       -> ArchiveSessionBudget
  -> ArchiveExecutionContext (one per archive)
       -> real nesting depth
       -> canonical ZIP reader
       -> canonical preflight
       -> archive-local + session-budget verdict
  -> read-only observation OR transactional localFiles materialization
```

### Run-scoped policy and budget

`resolveArchiveExecution` is the only policy/session resolution point used by
both archive paths. A multi-archive local-files run constructs one
`ArchiveExecutionResolution` and passes that same object to every top-level and
nested `ArchiveExecutionContext`.

`ArchiveSessionBudget` therefore remains acquisition-wide state. Archive count,
expanded bytes, and elapsed processing time never reset merely because the run
moved to another ZIP. The budget is consulted before an accepted archive starts,
checked for elapsed-time exhaustion during member streaming, and consumed only
after a verified archive succeeds. Dry-run performs equivalent in-memory budget
accounting so later archives receive the same run-level decision while source
mutation remains zero.

### Immutable archive identity

Every `ArchiveExecutionContext` stages its source ZIP to a tool-owned temporary
snapshot and computes SHA-256 in that same streaming pass. Central-directory
reading, preflight, CRC verification, and materialization read the staged path,
not the live source path. Consequently the archive digest, admission verdict,
and bytes written all describe one immutable byte sequence even if the original
path changes during the run.

### ZIP framing

EOCD search validates candidate framing while scanning backward. A legal ZIP
comment may contain `PK\x05\x06`; a signature-shaped sequence is skipped unless
its own declared comment terminates exactly at physical EOF. The chosen EOCD
must also be structurally adjacent to the complete central-directory span. For
Zip64, the Zip64 EOCD must terminate at its locator and the central directory
must terminate at the Zip64 EOCD. Split/multi-disk fields are rejected.

This prevents a fake EOCD inside the real comment from hiding a suffix of the
central directory and avoids rejecting a valid archive merely because arbitrary
comment bytes happen to contain the EOCD signature.

### Transactional materialization

`localFiles` never writes members into the live target. It creates a
same-parent candidate, streams and verifies every selected member from the
staged ZIP, writes ownership only after the candidate is complete, then swaps
the candidate into place. An existing valid target is renamed to a backup first
and restored if the candidate rename fails. Backup removal happens only after
the new target is live.

A CRC failure, format failure, resource/deadline refusal, write failure, or swap
failure therefore cannot leave a partially refreshed target presented as the
current extraction.

### Ownership provenance

The ownership marker schema is
`l9-meta-injector.local-files-extraction/v2`. A complete marker contains:

- exact schema id;
- exact owner id `l9-meta-injector.local-files`;
- owning archive basename;
- SHA-256 of the immutable staged archive bytes that produced the extraction;
- canonical reader version;
- semantic resolved-policy fingerprint;
- creation timestamp.

Destructive replacement requires a complete valid v2 marker and a marker archive
basename matching the sibling archive being refreshed. Empty unmarked targets,
partial/forged-shape markers, foreign markers, and legacy v1 markers are user
data for destructive purposes and are not replaced automatically.

### Policy identity and validation

Caller policy overrides are validated before archive I/O. Integer ceilings must
be finite and in their valid positive/non-negative domains; compression ratio
must be finite and positive. `NaN`, infinities, negative limits, fractional
counts, and equivalent nonsensical ceilings fail closed.

The policy `version` is informational and does not contribute to the semantic
policy fingerprint, matching ADR-044. The fingerprint describes the resolved
rules, not their label.

### Dry-run equivalence

Dry-run uses the same immutable staging, parser, preflight, ownership inspection,
real nesting depth, and run-scoped budget as real execution. Only the mutation
commit is suppressed. It may say "would extract" only when real execution would
be admitted at that point in the same run.

### Validation evidence

The validation report binds actual tracked and untracked filesystem content with
NUL-delimited Git path discovery, so unusual filenames are not replaced by Git's
display quoting. The digest includes file content/type and executable state and
excludes only `CURRENT_VALIDATION_REPORT.md`. A second edit of an already-dirty
file therefore changes the digest, and `--check` additionally refuses a dirty
non-report tree.

## Consequences

- A v1 extraction cannot be refreshed automatically. The operator removes it
  once and re-extracts under v2.
- Refresh temporarily needs space for the complete candidate and, when replacing
  an existing target, the previous extraction until the swap commits.
- Archive staging consumes temporary storage outside the source tree but removes
  it when the context is disposed.
- Tightening a session ceiling may cause a later archive in a run to be held even
  when that archive is locally valid. This is intentional acquisition-wide
  resource governance.
- Package runtime support remains Node `>=18`; test worker parallelism therefore
  falls back to `os.cpus().length` where `os.availableParallelism()` is absent.
- `v4.0.0` remains immutable historical release state. This convergence is a
  patch-release candidate and does not rewrite the existing tag.
