# ADR-089: Architecture statement reader 1.1.0 — coverage closure under an exact matrix

## Status

Proposed. Candidate for owner review, amending the reader decided in
[ADR-087](087-architecture-evidence-projection.md) (itself Proposed). The projection stays
opt-in and producer-local; no consumer binding, packet, Topology or Semantic Foundation
change. The owner decides whether the coverage matrix below is the supported-input
definition this package keeps versioned with the reader.

## Date

2026-11-08

## Context

ADR-087 shipped `architecture-statements/v1` 1.0.0 with five classes and three explicit
forms and recorded its known gaps. Running it over real documents — this repository's own
`docs/` tree and a probe set of common specification shapes — showed defects that were
not listed:

- **Wrong attribution.** A Markdown list item wrapped onto a second line (a CommonMark lazy
  continuation) became two statements, and the continuation line was filed under the
  enclosing section. Under `## Constraints`, the items of a following `Assumptions:` list
  were then recorded as *constraints*. On the `docs/` tree, 411 of 734 records were such
  fragments of 206 real statements.
- **Invented values.** Frontmatter `objective: |` was quoted as the statement `|`, and a
  trailing YAML comment was quoted as part of the value — although the work reader
  already applies the YAML scalar rules (RC-024) to the same lines.
- **Silent misses.** `## 1. Constraints`, `### 2.1 Open Questions`, `## A. Decisions`,
  `## Assumptions (v2)` and an underlined (setext) `Constraints` heading opened no section
  and raised nothing, so the absence was indistinguishable from a document that declared
  nothing.
- **A mention read as a declaration.** `` `Decision:` — is read by … `` (a label inside an
  inline code span) was quoted as a decision.
- **Soft line breaks.** A Word list paragraph or labelled paragraph with a soft line break
  became two statements; a thematic break under a section was quoted as a statement.

## Options Considered

### Option A: leave 1.0.0 and extend the known-gaps list

- Pros: no identity moves.
- Cons: the wrong-class attribution is a correctness defect, not a coverage gap; leaving
  it means the projection files assumptions as constraints.

### Option B: fix the decoder (frontmatter, setext, list continuation constructs)

- Pros: one place for Markdown structure.
- Cons: moves the text decoder version, every normalized document id and every cached
  decode for an output nobody asked for; out of scope for an opt-in projection.

### Option C: close the gaps in the reader, under a published, test-bound matrix

- Pros: changes only the opt-in projection; the decoder, interpretation profile, packets,
  source snapshot and caches are untouched; every closed gap and every remaining one is
  stated case by case and proven against real files.
- Cons: the reader recognizes block shapes the decoder does not name (frontmatter,
  setext, continuation); each is a structure the format itself defines and is bounded.

## Decision

We choose **Option C**.

1. `architecture-statements/v1` moves to **1.1.0**. The extractor *id* does not move: it
   is hashed into every `evidence_id`, and a statement 1.1.0 reads exactly as 1.0.0 did
   keeps its id. The five classes, the closed label vocabulary and the three recognition
   forms are unchanged; no class, label or form is added.
2. Grammar added, each a structure the document format defines:
   - a section heading may carry one section number (`2.`, `2.1`, `3.4.1.`, `A.`, `b)`)
     and one trailing parenthetical qualifier (`(v2)`); what remains must be a vocabulary
     label exactly;
   - a setext (underlined) heading in a `line_span` document is a heading;
   - a paragraph on the line directly after a Markdown list item (no blank line) is that
     item's lazy continuation and is joined to it when every line is running text; the
     enclosing label list or section stays open;
   - running text after a labelled value continues it across a soft line break, in any
     format; a Word list paragraph is one item however many soft breaks it holds;
   - frontmatter (the work reader's own delimiters and line bound) is read with the work
     reader's own YAML rules, now exported once (`readFrontmatterLine`): comments cut,
     quoted scalars unquoted, a block scalar's value read from its indented lines, a flow
     collection reported; a comment line arriving as an ATX heading is ignored;
   - a thematic break is never a statement; a colon inside an inline code span is not a
     label.
3. One new coverage diagnostic, `architecture_evidence.heading_not_recognized`, for a
   heading that names a vocabulary label inside a phrase the grammar refuses
   (`Constraints and Assumptions`, `Decision Outcome`); two for frontmatter
   (`frontmatter_flow_collection_unsupported`, `frontmatter_block_scalar_unread`).
4. Records gain `continuation_block_ids` (the blocks a statement continues into, in
   order), and a `line_span` locator ends on the statement's last line. The schema stays
   `l9.architecture-evidence/v1` (additive field); `ARCHITECTURE_EVIDENCE_PROFILE_VERSION`
   moves to 1.1.0 and the profile hash — and so `corpus_analysis_id` of a run that selects
   the projection — moves with it. A default run is unchanged in every identity.
5. `docs/architecture-statement-coverage.json` (`l9.architecture-statement-coverage/v1`)
   is the exact supported-input definition: 37 cases (21 supported, 8 unsupported,
   8 excluded), each with its source and the **complete** records and diagnostics a real
   file of that form produces, every record's coordinate verified against the source.
   `tests/architecture_statement_coverage.test.ts` enforces equality in both directions and
   requires a case for every diagnostic code the reader can raise.
   `docs/architecture-statement-coverage.md` renders it.

## Consequences

- Measured on `docs/` at `075c4ef` (148 documents): 734 → 528 records; 322 `evidence_id`s
  preserved with byte-identical text, locator and class; 411 removed fragments are each
  inside a same-class 1.1.0 statement covering their line; 1 removed record was the
  inline-code mention; the 206 new records are all the reassembled multi-line statements.
  No statement changed class or was lost. `corpus_source_snapshot_id` is unchanged.
- A consumer comparing runs across the version boundary sees the analysis id move and
  must treat `evidence_id`s of the reassembled statements as new.
- Still not read, and stated in the matrix: tables, ambiguous or phrase headings,
  frontmatter flow collections and blank-line-split block scalars, bare `Questions`,
  unlabelled prose.
