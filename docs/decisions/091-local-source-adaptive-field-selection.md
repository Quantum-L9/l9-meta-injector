# ADR-091: Adaptive field selection for local-source, as a derived view

## Status

Proposed. Candidate for owner review. Opt-in, producer-local, no package export, no
consumer binding, no packet, Topology or Semantic Foundation change.

## Date

2026-11-08

## Context

A local-source generation is deliberately complete: every declared statement
(ADR-087/089), every work assertion, every duplicate relation, with document roles from
explicit declarations (ADR-090). A reader with a purpose — reviewing architecture, picking
up a handoff, auditing history, exploring a design — needs the few fields that matter for
*that* purpose and *that* kind of document, bounded, and needs to know why the rest were
not shown. Filtering the payloads would lose completeness; asking every consumer to
re-derive a choice from raw payloads would scatter one policy across consumers.

## Options Considered

### Option A: selective indexing (index less for a given intent)

- Cons: deletes evidence from the complete index; a second intent would need a second
  scan; violates the completeness contract of the payloads.

### Option B: a scoring engine over fields

- Cons: weights are unexplainable and tunable without bound; a score is not evidence.

### Option C: one closed, deterministic policy writing a derived view beside the payloads

- Pros: the complete payloads are untouched; every choice is a table row plus the
  document's own evidence; the view cites existing ids only; bounded; identity-bound.
- Cons: the tables are a product decision that will need review as intents are added.

## Decision

We choose **Option C**.

1. `src/corpus_field_selection.ts`, policy `local-source-field-selection/v1` 1.0.0: closed
   intents (`architecture_review`, `design_exploration`, `development_handoff`,
   `history_audit`), a closed field vocabulary of existing evidence fields, an intent table
   (core/supporting), a role-promotion table over ADR-090 roles, availability, redundancy
   (value identity within a document; non-representative exact-duplicate members), and a
   per-document budget (fields, values per field, characters). Dispositions: `selected`,
   `redundant`, `omitted_by_budget`, `unavailable`, `not_selected_for_intent`; every
   decision states its reasons.
2. Built in `runCorpusScan` after the duplicate analyses, from records the run already
   holds; written as `field-selection.jsonl` + manifest through the same atomic generation;
   verified before publication (counts, hashes, tallies, every cited id carried by a payload
   of the generation, budget, carrier).
3. Carrier disposition `external_generation`; `central_manifest` and `inline_managed`
   recorded as refused (ADR-036). No observed file is written.
4. `field_selection_profile` (policy + intent + budget) enters `corpus_analysis_id` only
   when selected; `--field-selection` requires `--architecture-evidence`.
5. A run without the flag is unchanged: the two files are listed in `corpus-index.json`
   only when written (unlike ADR-087's always-listed pair), and the summary line is
   printed only when written.

## Consequences

- Measured on `docs/` at `075c4ef` (132 evidence-bearing documents): selected fields per
  intent 233 / 159 / 298 / 166 (architecture review / handoff / history / exploration),
  at most 1,395 characters per document, the source snapshot identical across all four and
  each intent its own analysis id.
- Default and `--architecture-evidence`-only runs are identical to the previous build in
  every output file apart from two pre-existing wall-clock fields
  (`local-source-manifest.json` `observed_at`, `corpus-intelligence/packet.json`
  `created_at`), which are not affected by this change.
- Not decided: exposing the view through `corpus-query`; more intents; any field outside
  the existing evidence.
