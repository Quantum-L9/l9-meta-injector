# ADR-090: Document-role selection closure — decision records, research and historical material

## Status

Proposed. Candidate for owner review, amending the selection profile decided in
[ADR-087](087-architecture-evidence-projection.md) §5 and the query of
[ADR-088](088-read-only-corpus-evidence-query.md) (both Proposed). No package export, no
packet, Topology or Semantic Foundation change; no consumer binding.

## Date

2026-11-08

## Context

`architecture-development/v1` assigned roles only from `work.kind`, `work.status` and
handoff predicates. A design corpus is mostly decision records, and a decision record
declares what it is in one place the work reader does not read: `## Status` followed by
`Accepted.`, `Proposed.` or `Superseded by ADR-012.`, or `- **Status:** Accepted`. On
this repository's own `docs/` tree, 77 of the 80 documents that declare statements fell to
`unknown`. The table had no role for research or for historical (superseded, archived)
material, so neither could be selected for, or asked for, at all. The query CLI could filter
by statement class but not by role or by the selected view.

Teaching the work reader the decision-record vocabulary would move the interpretation
profile, every Repository Model Packet identity and every cached interpretation — for an
opt-in projection's benefit. The selection already holds the document's normalized blocks.

## Options Considered

### Option A: add decision-record statuses to the work vocabulary

- Pros: one reader of `Status:`.
- Cons: moves the interpretation profile and every root RMP identity on every run, selected
  or not; out of scope for an opt-in view.

### Option B: read the declarations in the selection, over the blocks it holds

- Pros: identity-neutral for default runs and for every `evidence_id`; the declarations are
  cited by block and coordinate exactly like statements; the work reader's `Label: value`
  grammar and the statement reader's heading grammar are reused, not redefined.
- Cons: two readers look at `Status:` lines; resolved by reading only values the work
  vocabulary does not already read.

### Option C: infer roles from paths, filenames or prose

- Rejected: not evidence a document gave about itself.

## Decision

We choose **Option B**.

1. Selection profile `architecture-development/v2`, policy version 2.0.0. Roles:
   `decision_record`, `development_handoff`, `historical_record`, `research`,
   `specification`, `wip_proposal`, `unknown`. `research` moves out of the proposal kinds
   into its own role; `decision` moves from `specification` to `decision_record`.
2. Two block-read declaration predicates, closed vocabulary, explicit forms only:
   `document.declared_status` (first word of the first paragraph or list item under a
   heading labelled `Status`, or of a `Status:` label's value, in `accepted`, `deprecated`,
   `proposed`, `rejected`, `superseded`; a `Status:` value the work reader already reads is
   not read again) and `document.decision_record_title` (a title opening `ADR-NNN`). Each
   carries a stable `declaration_id`, its `block_id` and coordinate, and is listed in
   `work_context.declarations`; role evidence names its `source`.
3. Contradictions are kept: `selection.status_families` and `selection.status_conflict`
   report a document that declared statuses from more than one of `in_progress`, `settled`,
   `retired`; every role applies and nothing is resolved.
4. The policy is hashed on its own (`selection_policy_hash`) and included in the profile
   hash bound into `corpus_analysis_id` when the projection is selected. Profile version
   1.2.0. Selection changes no `evidence_id`, no source snapshot, no packet.
5. The payload verifier refuses a record whose `selected` disagrees with its reasons, or
   that is selected by a declared role with no role evidence.
6. `corpus-query` gains `--role NAME` and `--selected-only`, both opt-in and both answered
   from architecture-evidence records only. The response echoes `role` / `selected_only`
   only when asked, so a default query's bytes are unchanged; a generation without the
   projection answers `unsupported`.

## Consequences

- Measured on `docs/` at `075c4ef`: `unknown` documents 77 → 2; 75 decision records (74 by
  `ADR-NNN` title, 69 accepted, 5 proposed, 1 superseded), 1 historical record, 8 WIP
  proposals; 528 records before and after with identical `evidence_id`s, text, coordinates
  and classes; default query responses byte-identical between the two query builds on the
  same generation.
- Not decided here: whether an accepted record is authoritative (it is a declaration), any
  supersession resolution across documents, and any role from paths or prose.
