# ADR-089: An intent-bound metadata-selection view over the architecture evidence

## Status

Proposed. Candidate for owner review. The surface ships as an opt-in switch of the
local-source CLI and a non-exported module; nothing in the package contract, the public
API, the acquisition or decoding pipeline, the interpretation profile or any Accepted
contract changes. The owner decides whether `local-source-metadata-selection/v1` is a
policy this package keeps versioned.

## Date

2026-11-07

## Context

A local-source run read with `--architecture-evidence` (ADR-087) publishes every
statement its documents declared, each with the full record: two identities, the
coordinate, the declared text and its excerpt, the bytes' hash, the document's own
kind, status, applicability and handoff declarations, and the role verdict of
`architecture-development/v2` with the evidence behind it. That completeness is the
contract. It is also more than any one consumer wants: an engineer preparing a handoff
wants the constraints, the open questions and the task counts; a reviewer of an archived
design wants what it decided and what replaced it; neither wants the other's fields,
and neither wants an undeclared note's assumptions in a view of accepted declarations.

Three facts bound the design. The evidence contract already carries every field a view
could want, so a view that invents a field would be a second claim about the document.
The role policy already says, from the document's own declarations, what each document
is — so "which documents serve this intent" is a lookup over existing verdicts, not a new
judgement. And the generation mechanism (ADR-042, ADR-066) already publishes every
projection of one run under one atomic pointer, so a view has a place to live that is not
inside any observed file.

## Options Considered

### Option A: a scoring engine over records and fields

- Pros: adapts to corpora the table did not anticipate.
- Cons: a weight is a conclusion about relevance the generation never recorded; two
  runs over the same bytes could carry different fields for reasons no reader can check
  against a row. Rejected as the ranking the contract forbids.

### Option B: writing the selected metadata into the observed documents

- Pros: the document carries its own summary.
- Cons: mutates the corpus a read-only run observed, changes `corpus_source_snapshot_id`
  on the next run, and makes the view part of the evidence it was derived from. Rejected:
  local-source stays external-generation by default.

### Option C: one static intent table applied as a derived view beside the evidence

- Pros: every verdict and every field disposition names the row or rule that produced
  it, and the manifest carries the whole table; the view is a pure function of the
  evidence payload, so it is deterministic and verifiable with the same shape of receipt
  the evidence has; the evidence stays complete beside it; the policy and intent bind
  into `corpus_analysis_id` and nothing else moves.
- Cons: a corpus whose documents declare roles outside the table gets the table's
  answer. That is the bound the contract asks for, and the reason is recorded per record.

## Decision

We choose **Option C**.

1. `src/corpus_metadata_selection.ts` holds the policy `local-source-metadata-selection/v1`:
   four intents (`wip_design`, `accepted_declaration`, `development_handoff`,
   `historical_review`), each a row of roles, of declared `work.status` values (the
   lifecycle axis the role policy keeps separate from roles), an unknown-role retention
   bit, a class order, a field list and a per-document bound; a catalog of sixteen existing evidence
   fields with an always-set of six; three field-level rules (not in intent, empty,
   redundant) and nothing else.
2. `--metadata-selection INTENT` on the local-source CLI (`metadataSelection` on
   `runCorpusScan`) selects it. It is refused without `--architecture-evidence` and with
   an intent outside the vocabulary, before anything is read.
3. The view is built from the `ArchitectureEvidenceExport` the scan already holds, after
   it, and from nothing else: no document is re-read, no cache layer is touched, no
   field is invented. Every evidence record gets exactly one view record, in the
   evidence payload's order, with `included`, a reason from a closed vocabulary and an
   explanation naming the row; an included record carries copies of its selected fields
   and a disposition for every catalog field.
4. `metadata-selection.jsonl` and its manifest publish through the generation; the
   manifest states the policy table, the intent, the evidence it derives from by hash,
   and the carrier disposition `external-generation` with `mutates_observed_files: false`.
   `verifyMetadataSelectionExport` runs before publication and refuses a view that
   disagrees with its manifest, its evidence or its own rules.
5. `metadata_selection_profile` — the hash of the policy and the intent — enters
   `corpus_analysis_id` only when selected (`CorpusAnalysisProfiles`, `corpusAnalysisId`).
   The source snapshot, the root packets, the evidence payload and every `evidence_id`
   are unchanged with or without it and across intents.
6. Not done, and out of scope: any index compiler, registry, vector store, authority
   resolver, context assembler, sidecar writer or scoring engine; any change to the
   evidence contract, the role policy, the query, the pipeline, or the global semantic
   vocabulary; any write into an observed file.

## Consequences

- A consumer can take the view for its intent and still verify every carried value
  against the evidence record it names, and can see why every other field was left out.
- Adding an intent or a field is a row in the table and a policy version: the hash
  moves, the identities of runs that did not select the view do not.
- The bound is deliberate and visible: `bounded_out` records are counted in the
  manifest and listed in the payload, so a reader who needs them knows where they are.
- Validation: `tests/metadata_selection.test.ts` reads one mixed corpus under all four
  intents from a real generation and proves pairwise-distinct, explained views; the
  bound; the field accounting; the identity boundary; the verifier's refusals; and the
  CLI's refusals, outputs, index listing and untouched roots.
