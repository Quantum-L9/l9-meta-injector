# Architecture evidence

What a design corpus explicitly says it intends, assumes, is bound by, has not resolved
and has decided — found by what the documents wrote, cited where they wrote it, and
never promoted into something they did not say.

Authority: [ADR-087](decisions/087-architecture-evidence-projection.md) (Proposed).
Reads the blocks of [ADR-043](decisions/043-document-statements-are-read-and-cited-where-they-were-made.md);
publishes through the generation mechanism of [ADR-042](decisions/042-binary-document-decoding-generational-publication-and-bounded-candidate-work.md)
and [ADR-066](decisions/066-generation-retention-order-and-exclusive-publisher-lock.md);
enters the analysis half of the identity split of [ADR-041](decisions/041-corpus-source-identity-verification-class-and-partial-corpora.md).

## Selecting it

```bash
npm run local-source -- --root /Volumes/Designs=Designs --out <dir> --architecture-evidence
```

Off by default. A run that does not pass the flag is the run it always was: the same
`corpus_source_snapshot_id`, the same `corpus_analysis_id`, the same packets, the same
`document-work-signals.jsonl`, the same cache. The corpus index lists the two files
below as `present: false`, and the CLI prints `architecture     not run`.

`--architecture-evidence` is refused together with `--no-interpret`: the selection profile
reads each text document's declared `work.kind` and `work.status` through the
interpretation pass, and without it every Markdown proposal would silently become an
`unknown` role. A decoded document with no blocks (an empty file) counts in
`documents_read` and declares nothing.

With the flag, the generation gains:

```text
architecture-evidence.jsonl            l9.architecture-evidence/v1           one record per statement
architecture-evidence.manifest.json    l9.architecture-evidence-manifest/v1  counts, hashes, diagnostics
```

and `corpus-snapshot.json` carries `analysis.architecture_evidence_profile` (the rules'
hash, bound into `corpus_analysis_id`) and `architecture_evidence` (the payload's record
count and two hashes). Programmatically: `runCorpusScan({ …, architectureEvidence: true })`
returns `result.architectureEvidence`; it is `null` when not selected.

## Reader 1.1.0 and the exact coverage matrix

[ADR-089](decisions/089-architecture-statement-coverage-closure.md) (Proposed) moves the
reader to 1.1.0 without changing its id, classes, vocabulary or forms. What it reads, what
it reports and what it leaves alone is stated case by case — with the complete records and
diagnostics a real file of each form produces — in
[architecture-statement-coverage.md](architecture-statement-coverage.md), and enforced by
`tests/architecture_statement_coverage.test.ts`. In short, 1.1.0 adds numbered
(`## 2.1 Open Questions`), qualified (`## Assumptions (v2)`) and setext section headings;
joins a Markdown list item's lazy continuation and a soft-broken labelled value or Word list
item into one statement (records carry `continuation_block_ids`, and a `line_span` ends on
the statement's last line); reads frontmatter with the work reader's YAML scalar rules; and
never quotes a thematic break or a label inside an inline code span. Where this page and the
matrix differ, the matrix is the current statement.

## Statement classes and how each is recognized

Five classes, closed. A statement is recognized from one of three explicit forms and
from nothing else: not from prose that sounds like a constraint, not from a question
mark, not from a filename, a date, a similarity score or a model.

| Class | Labels recognized (case-insensitive, emphasis ignored) |
|---|---|
| `intent` | `Objective`, `Objectives`, `Goal`, `Goals`, `Intent` |
| `constraint` | `Constraint`, `Constraints`, `Invariant`, `Invariants` |
| `assumption` | `Assumption`, `Assumptions` |
| `open_question` | `Open question`, `Open questions`, `Unresolved`, `Unresolved question`, `Unresolved questions` |
| `decision_statement` | `Decision`, `Decisions` |

| Form | Shape | What is quoted |
|---|---|---|
| `field_label` | `Decision: Gate is the only routing authority.` — a `Label: value` line, with the same list-prefix and emphasis tolerance the work reader has (`**Objective:** …`, `- Constraint: …`) | the value |
| `label_list` | `Constraints:` with nothing after the colon, then the lines after it in the same block or the list items that follow the block | each item |
| `section_heading` | a title or heading block whose text is a label (`## Open Questions`, a Word `Heading 1` reading `Invariants`), then every list item and paragraph until the next heading, title or code block | each item; each paragraph as one statement |

The reader walks the normalized blocks a decoder already produced, so a Markdown file, a
Word document, a deck, a worksheet, a notebook, a PDF and a saved page are read by one
implementation. It opens no file and recomputes nothing the cache holds.

What is never quoted as a statement, and what happens instead:

| Construct | Outcome |
|---|---|
| a unit the work vocabulary claims (`Status: active`, `- [ ] task`, `Depends on: …`) under a labelled section | skipped silently; it is already a work signal |
| a `Label: value` line under a labelled section whose label is in neither vocabulary (`Owner: mel`, `Type: specification`) | skipped; `architecture_evidence.labelled_member_skipped` |
| a table (a `table` block, or a Markdown pipe table) under a labelled declaration | skipped; `architecture_evidence.unsupported_member_block` |
| `Constraints:` with nothing attributable after it | `architecture_evidence.empty_declaration` |
| `## Decisions` with nothing attributable under it | `architecture_evidence.section_without_items` |
| a statement whose text resembles a credential | dropped, never redacted; `architecture_evidence.secret_value_suppressed` |
| a statement longer than 1024 characters | cut, with `declared_text_truncated: true`; `architecture_evidence.statement_truncated` |
| fenced or `code` blocks | never read |

Diagnostics are bounded at eight per document; the manifest states how many more were
raised. A document the reader was given and found nothing in is counted in
`documents_read` and is not a diagnostic.

Known gaps, stated rather than closed: a heading that carries a label inside a longer
phrase (`Open Questions (v2)`), a bare `Questions` heading, Markdown frontmatter keys
(the text decoder has no frontmatter construct, so `decision:` in frontmatter is read as
a labelled line), and a statement split across a soft line break inside one Word
paragraph, which is quoted as the unit it sits on.

## The coordinate

Every record cites the block it was read from and the coordinate that block's format
has. A `line_span` block's lines map one to one onto the file's lines, so a statement on
unit *k* of a Markdown block cites line `line_start + k` exactly; the tests read that
line back from the file and check it holds the excerpt. Every other locator kind —
`docx_block`, `pptx_shape`, `spreadsheet_cell`, `pdf_page_block`, `notebook_cell`,
`html_node`, `csv_row` — is cited verbatim, with `unit_index` beside it saying which
line of the block's text the statement is on. No format is given a line number it does
not have (ADR-043).

## The record

```json
{
  "evidence_id": "architecture_evidence:…",
  "artifact_id": "vsrc:…",                  "rmp_artifact_id": "artifact:…",
  "source_path": "plans/gate-routing-proposal.md",   "format": "markdown",
  "raw_content_hash": "sha256:…",            "normalized_document_id": "normdoc:…",
  "decoder_id": "l9.text-decoder",           "decoder_version": "…",
  "block_id": "block:…",                     "block_kind": "list_item",
  "structured_locator": {"kind": "line_span", "line_start": 11, "line_end": 11},
  "unit_index": 0,
  "statement_class": "constraint",
  "declared_text": "TransportPacket is the only wire format.",
  "declared_text_truncated": false,
  "bounded_excerpt": "TransportPacket is the only wire format.",
  "recognition": {"form": "section_heading", "label": "constraints"},
  "work_context": {
    "kinds":    [{"predicate": "work.kind",   "object": "proposal", "assertion_id": "assertion:…"}],
    "statuses": [{"predicate": "work.status", "object": "wip",      "assertion_id": "assertion:…"}],
    "applicability": [{"predicate": "work.status", "object": "wip", "assertion_id": "assertion:…"}],
    "handoff": []
  },
  "selection": {
    "profile_id": "architecture-development/v1",
    "roles": ["wip_proposal"],
    "role_evidence": [{"role": "wip_proposal", "predicate": "work.kind", "object": "proposal", "assertion_id": "assertion:…", "count": 1}, …],
    "selected": true,
    "reasons": ["wip_proposal selects constraint: work.kind=proposal (assertion:…), work.status=wip (assertion:…)"]
  },
  "epistemic_class": "source-declared",
  "authority_verified": false,
  "extractor_id": "architecture-statements/v1", "extractor_version": "1.0.0", "profile_version": "1.0.0"
}
```

`artifact_id` resolves in `document-index.json` and `corpus-snapshot.json`;
`rmp_artifact_id` is the same artifact inside its root's Repository Model Packet; the
`assertion_id`s under `work_context` and `role_evidence` resolve in that packet (text
documents) or in `document-work-signals.jsonl` (decoded formats). A record carries both
identities for the reason `document-work-signals.jsonl` does: a consumer works in one
domain and should not have to derive the other.

Records are ordered by `artifact_id`, `block_id`, `unit_index`, `statement_class`,
`declared_text`, `evidence_id`. Contradictory declarations — two `Decision:` lines that
disagree, a constraint stated twice — are all retained; choosing between them needs the
whole corpus in view and is not this pass's job.

**Every record is source-declared and none is authority-verified.** A
`decision_statement` is a document recording a decision. It is not an accepted ADR, an
authoritative contract or an approved implementation, and nothing in this payload says
which of a document's declarations still hold. The manifest restates this, and the
payload verifier refuses a record that claims otherwise.

## The selection profile

`architecture-development/v1` is a view over the records, not a filter and not a
vocabulary. It reads what the document already declared about itself — `work.kind`,
`work.status`, and whether it carries tasks, blockers or dependencies — assigns roles
from a static table, and marks which classes a reader of that role is looking for.

| Role | Established by | Selects |
|---|---|---|
| `wip_proposal` | `work.kind` in `design`, `notes`, `plan`, `proposal`, `research`, `roadmap`; or `work.status` in `draft`, `planned`, `wip` | all five classes |
| `specification` | `work.kind` in `decision`, `specification` | `constraint`, `decision_statement` |
| `development_handoff` | `work.kind` `checklist`; or any `work.task.open`, `work.task.completed`, `work.blocked_by`, `work.depends_on` | `constraint`, `open_question` |
| `unknown` | none of the above | all five classes |

Roles overlap and the selection is the union. `selection.reasons` names, for each
selecting rule, the predicate, object and assertion id that established the role. An
unselected record has an empty reason list: no rule selected it, nothing judged it. An
undeclared role selects everything, because not knowing what a document is for is no
reason to hide what it said. `work_context.applicability` carries the document's
`work.status`, `work.supersedes` and `work.superseded_by` declarations, and
`work_context.handoff` counts its tasks, blockers, dependencies and references, on every
record, so the view can be re-derived by a consumer with a different table.

There are no weights, no scores, no classifier and no rule language. Changing the table
is a change to `ARCHITECTURE_EVIDENCE_PROFILE_VERSION`.

## The manifest

| Field | What a consumer does with it |
|---|---|
| `record_count`, `payload_byte_length` | count the lines, check the bytes |
| `payload_artifact_hash` | SHA-256 of the exact bytes — nothing was rewritten |
| `payload_semantic_hash` | SHA-256 over the canonical records — survives a move |
| `selected_record_count`, `by_class`, `by_format`, `by_role`, `by_recognition_form` | totals the records must support |
| `document_count`, `documents_read` | documents that declared something, documents the reader was given |
| `diagnostics`, `diagnostic_count`, `diagnostics_omitted` | every construct outside the grammar, by artifact and block |
| `profile_hash`, `extractor_version`, `selection_profile_id` | the rules that produced this |

The scan verifies the payload against the manifest before the generation is published
and refuses to publish on any disagreement — the same guard `document-work-signals.jsonl`
has.

## Identity

Selecting the projection binds `architecture_evidence_profile` into
`corpus_analysis_id` and into nothing else. The profile hash covers the reader's
vocabulary, forms, block kinds and bounds, the selection table and the record schema.
It is absent — not null — from a run that did not select the projection, so that run's
analysis identity is unchanged by the projection's existence. Nothing enters
`corpus_source_snapshot_id`, no packet, no interpretation profile and no cache key: a
warm cache serves a run that newly selects the projection with no misses.

## What this is not

No file is read by this pass, modified, or given an inline header. No embedding, vector
search, model call or semantic inference is made. No authority is resolved, no
supersession reconciled, no Topology relation or Semantic Foundation field added, no
development context assembled, no agent invoked. The statement classes are a
producer-local vocabulary under ADR-087, which is Proposed: admitting them anywhere else
is a separate decision for the owner of that surface.
