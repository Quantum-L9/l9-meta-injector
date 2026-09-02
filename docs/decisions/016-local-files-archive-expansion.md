# ADR-016: Local-files mode expands archives before injection

## Status

Accepted, **amended by ADR-044 and ADR-045**.

ADR-016 remains the decision that local-files archive expansion is explicit and
opt-in. Its original implementation details about a system `unzip` subprocess
and dry-run extraction are superseded by the canonical reader and transactional
materialization decisions in ADR-044 and ADR-045.

## Date

2026-07-31

## Context

Default pipeline discovery treats `.zip` (and other archive extensions) as
`skip-binary`: they are excluded from scan and members inside the archive are
invisible. That remains correct for repository mode.

Operators also run the injector against local folders where `.zip` files are
common carriers of the actual artifacts. In that setting, skipping archives
silently under-covers the tree.

## Decision

`PipelineConfig.localFiles` (CLI: `--local-files`) remains an explicit opt-in
pre-step before ordinary injection. ZIP archives are admitted by the package's
canonical ZIP reader, archive preflight, and resolved archive policy. Accepted
archives are materialized into sibling `*.l9extracted/` directories and receive
`<zip>.l9meta.yaml` sidecars; nested ZIPs are processed within the run-scoped
archive depth, count, byte, and time budgets.

The current execution semantics are defined by ADR-044 and ADR-045:

- no system `unzip` binary participates in archive admission or extraction;
- archive bytes are staged to an immutable tool-owned snapshot before parsing;
- one run-scoped `ArchiveExecutionResolution` supplies the policy and
  `ArchiveSessionBudget` across top-level and nested archives;
- materialization is transactional through a verified same-parent candidate and
  safe swap;
- destructive replacement requires the complete v2 ownership marker and matching
  archive basename;
- `--dry-run` performs the same staging, admission, ownership, and budget
  reasoning as real execution while performing **zero source-tree mutation**.

Default repository mode remains non-extracting.

## Consequences

- Repo / CI callers must not pass `localFiles` unless they intend real-mode
  filesystem mutation through transactional sibling materialization.
- Local-files ZIP handling has no external `unzip` dependency.
- Dry-run never creates an extraction directory or archive sidecar.
- Coverage reports `archivesExpanded`; `archives-expanded.json` is written to the
  index directory on non-dry runs.
- The shared omit layer (ADR-017) applies to archive discovery and member
  materialization.
- Further archive formats (`.tar.gz`, etc.) remain out of scope until a follow-up
  decision explicitly adds them to the canonical archive authority.

## Superseded implementation notes from the original ADR

The original ADR stated that local-files mode required a system `unzip` binary
and that dry-run still extracted archive members. Those statements describe the
2026-07-31 implementation only and are no longer normative.
