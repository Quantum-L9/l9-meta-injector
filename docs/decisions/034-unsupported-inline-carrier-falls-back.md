# ADR-034: A file that cannot carry its own metadata falls back instead of aborting

## Status

Accepted

## Date

2026-08-16

## Context

[ADR-028](028-byte-preserving-frontmatter-safety.md) chose a narrow, fail-closed frontmatter
patcher: rather than reserialize a user's YAML, anything outside a small deterministic
subset fails. That choice was right, and its *failure mode* was wrong.

`readForInjection` threw `FRONTMATTER_UNSAFE` from inside the pipeline's injection loop.
The loop runs over every discovered file, so a single markdown document with richer YAML
aborted the whole repository operation. The qualification run met this immediately: a
frontmatter line reading `created: 2025-10-28T15:30:00Z` — valid YAML, an ordinary
timestamp — ended a repository-wide `apply` with an unhandled error. The only ways forward
were to edit the repository's own sources or to hand-write `--omit` patterns, both of which
make adoption a manual surgery exercise.

A second, quieter defect shared the same root. `verify` recovered the body of a frontmatter
file with `stripExistingFrontMatter`, which collapses every newline after the closing fence,
while `inject` captured the body with `inspectFrontMatterDocument`, which keeps it. Any file
that *already* had frontmatter followed by a blank line therefore reported
`Body content changed during injection (hash mismatch)` and aborted a governed `apply` —
for a file whose bytes after the fence were never touched.

## Options Considered

### Option A: Widen the patcher's YAML subset

- Pros: more files stay inline carriers.
- Cons: reintroduces exactly the risk ADR-028 rejected. The wider the grammar, the more
  user YAML the injector can silently normalize or reorder.

### Option B: Skip unsupported files silently

- Pros: trivial; the run completes.
- Cons: a file that governance believes is covered is not covered, and nothing says so.
  Silence is the failure mode this repository exists to remove.

### Option C: Classify before planning, and route to the central manifest with a diagnostic

- Pros: source bytes are preserved, the file is still governed via the central manifest, the
  reason is attached to the carrier decision, and the run continues.
- Cons: `inline_managed` coverage is lower than an operator might expect, so the fallback
  has to be visible rather than implicit.

## Decision

We choose **Option C**, plus one narrow grammar addition that costs nothing in safety.

**Classification precedes planning.** `runPipelineAsync` inspects each markdown document
once, before injection, and records an `InlineCarrierBlock` on the metadata subject. The
carrier policy consumes it: such a file is never `inline_managed`, and its decision carries
`authorityRule: frontmatter_unsupported:<CODE>` with a reason stating that the source bytes
are preserved. Both `check` and `apply` surface it.

**Opaque scalars.** `inspectFrontMatterDocument` gains a third field kind. A single-line
plain scalar the canonical parser declines — an unquoted ISO timestamp, a bare URL, a
`10:30` clock value — is carried as `opaque`: its byte range is known exactly, its meaning
is not. It never enters parsed `meta`, it is preserved verbatim when unmanaged, and it is
replaced wholesale when it happens to be a managed key. Flow collections, anchors, aliases,
merge keys, block scalars and partially quoted strings remain unsupported. This resolves
the timestamp case without widening what the patcher will rewrite.

**Hold only where the repository asked for something impossible.** A *malformed* header —
a missing fence, a duplicate block, a tab — that an explicit `inline_allow` pattern
authorized for inline mutation cannot be satisfied without destroying bytes we must
preserve. That, and only that, holds the operation, naming the code, the path and the file.
The same malformed file with no explicit inline authorization is an ordinary central-manifest
fallback.

**One body definition.** `verify` now recovers a frontmatter body with the same byte-exact
derivation `inject` used to capture it. `stripExistingFrontMatter` remains the fallback for
a header this parser cannot resolve, and remains exported unchanged.

## Consequences

- A repository-wide `apply` completes across files the patcher cannot rewrite. Their bytes
  are byte-identical before and after, and a second apply writes nothing.
- Repositories whose markdown already carried frontmatter can be governed at all. That case
  previously failed a body-preservation postcondition on the first apply.
- Coverage is honest rather than silent: every fallback is a carrier decision with a code,
  and `apply-cli` / `check-cli` print them as notes.
- Protected skill entrypoints (`SKILL.md`, `skill.md`) remain omitted before discovery and
  never enter inline mutation planning, regardless of their frontmatter.
- `FrontMatterField.kind` gains `"opaque"`, and `CarrierDecision` gains the optional
  `unsatisfiedInlineAuthorization` flag. Both are additive.
