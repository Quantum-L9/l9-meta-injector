# ADR-023: Deterministic identity and complete discovery accounting

## Status

Accepted for PR-1 Safety Envelope P-105.

## Context

The pipeline previously persisted absolute checkout paths and a fresh run timestamp
inside every metadata record. Discovery returned only surviving candidate files, so
hidden controls, omitted entries, binaries, unsupported encodings, unreadable paths,
symlinks, and other unsupported filesystem entries could disappear before coverage
accounting. An unreadable `.l9metaignore` was also ignored.

Those behaviors made outputs machine-specific and allowed absence of evidence to look
like complete coverage.

## Decision

1. `.l9metaignore` and an explicitly supplied `--omit-file` are strict inputs.
   Missing, unreadable, symlinked, non-file, binary, or invalid-UTF-8 sources fail.
2. Persisted metadata uses repository-relative POSIX `source_path` values.
3. Per-file metadata defaults `created_or_detected_at` to `Unknown`. A caller may
   provide an explicit stable timestamp through `PipelineConfig.metadataTimestamp`.
   Runtime start time remains in the operation result, outside canonical file metadata.
4. Discovery emits a deterministic ledger. Every encountered path receives exactly
   one terminal disposition.
5. Unreadable paths, symlinks, and unsupported filesystem entries make discovery
   incomplete. Apply fails before writes; check reports unsupported drift.
6. Coverage reports persist only relative ledger paths and a report-local filename.

## Consequences

- The same repository content can produce identical metadata bytes in different
  checkout locations.
- Coverage totals are mechanically reconcilable.
- Hidden control surfaces remain outside normal mutation discovery and continue to be
  inspected by the separate authority scanner.
- Conservative blocking may require operators to resolve symlinks or access failures
  before apply.
