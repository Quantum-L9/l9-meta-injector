# ADR-034: The declared legacy-writer policy decides, and marker text alone never blocks

## Status

Accepted

## Date

2026-08-16

## Context

[ADR-020](020-fail-closed-repository-authority-scan.md) established the fail-closed scan for
competing metadata authorities. Two defects in its implementation made a mature repository
un-adoptable without editing its own sources.

**The declared policy did nothing.** `.l9/meta-authority.yaml` carries
`legacy_writers: forbidden | migration_only`. The field was validated by
`isAuthorityConfig` and parsed by `parseAuthorityYaml`, and then never read again. No
runtime decision consulted it, so declaring `migration_only` changed no outcome. A
repository mid-migration had exactly the same options as one that had never migrated.

**Historical text was treated as an active writer.** `collectSurfaceEvidence` emitted
`legacy_marker` evidence for any file containing `L9_META`, `L9_ARTIFACT_META` or
`x-l9-meta` *if the same file contained any write signal anywhere* — including a generic
`json.dump`, `writeFileSync`, or `open(..., "w")` on an unrelated line. Every such marker
became a `META_LEGACY_METADATA_PRESENT` conflict, which blocked `check` and `apply`.

A repository that once carried L9 metadata keeps that text in its sources. Under the old
rule, adoption required deleting one's own history: the qualification run against
`Quantum-L9/L9-Ops-MCP` could only proceed by hand-stripping historical marker blocks.

## Options Considered

### Option A: Drop legacy-marker evidence entirely

- Pros: removes the false positive immediately.
- Cons: throws away real evidence. A marker beside a genuine competing writer is exactly
  what an operator needs to see; the problem was its *disposition*, not its collection.

### Option B: A second scanner that applies the policy after the fact

- Pros: no change to the existing scanner.
- Cons: two independent authority scanners is precisely the second-authority-corpus failure
  this repository forbids. They would drift.

### Option C: Make the declared policy an input to the one scanner, and tighten what counts as a writer

- Pros: one scanner, one decision table, evidence preserved regardless of disposition.
- Cons: requires a real definition of "active L9 metadata writer" rather than a proximity
  heuristic.

## Decision

We choose **Option C**.

Three kinds of evidence are now distinguished, and the repository's declared policy
disposes of them:

| Evidence | `forbidden` | `migration_only` |
|---|---|---|
| historical marker — legacy metadata text, no writer evidence | inert notice | inert notice |
| dormant writer artifact — a surface whose own evidence claims to write L9 metadata, invoked by nothing | conflict | migration notice |
| active invocation — a live control surface calling a competing writer | conflict | conflict |

`legacy_writers` is passed into `scanRepositoryAuthority` by `inspectRepositoryAuthority`
from the loaded authority. An unresolved authority leaves the policy undefined and every
writer signal fails closed, unchanged.

A write becomes an *L9 metadata* write only when it is tied to the L9 metadata surface:
either the write occurs on a line that also names it (`L9_META`, `x-l9-meta`,
`.l9/metadata-index`, …), or the file's own basename claims to inject, verify, generate or
sync L9 metadata. A generic `writeFileSync` or `json.dump` is never sufficient by itself.

Non-blocking findings are not discarded. `AuthorityNotice` carries them —
`META_LEGACY_METADATA_PRESENT` for inert markers, `META_LEGACY_WRITER_MIGRATION` for the
migration allowance — and both `CheckResult` and `ApplyResult` expose them.

## Consequences

- A repository with historical L9 metadata text adopts the canonical writer without editing
  its own sources. Zero marker strips were required to qualify `Quantum-L9/L9-Ops-MCP`.
- `migration_only` now means something: a dormant legacy writer artifact is recorded and
  allowed, while an active invocation of it still blocks.
- Every detected marker, writer artifact and invocation is preserved as evidence with its
  path, line and excerpt, whether or not it blocks.
- `META_LEGACY_METADATA_PRESENT` is retained in `AuthorityConflictCode` for type
  compatibility and is now produced as a notice rather than a conflict.
- The canonical `l9-meta-injector` invocation is never reported as a competing writer, even
  when a competing invocation appears elsewhere in the same file.
