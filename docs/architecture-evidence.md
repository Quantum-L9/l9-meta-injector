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
| `field_label` continuation | the non-empty lines after a labelled field inside the same block (a soft-wrapped paragraph, a Word line break) until the next label, work signal, table row or thematic break | folded into that statement (`unit_count` > 1, locator widened over the lines) |
| `label_list` | `Constraints:` with nothing after the colon, then the lines after it in the same block or the list items that follow the block | each item |
| `section_heading` | a title or heading block whose text is a label (`## Open Questions`, a Word `Heading 1` reading `Invariants`) — a leading section number and a qualifier after `(`, `—`, `–`, ` - ` or `:` are ignored (`## 2. Open Questions (v2)`) — or a single bold or numbered bare label on its own line (`**Decisions**`, `3.1 Invariants`); then every list item and paragraph until the next heading, title or code block | each item; each paragraph as one statement |
| `frontmatter_field` | `decision: …`, `objective: …` between the leading `---` fences of a text file | the value |

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

The complete supported-input definition — every form, every refusal, and how each
coordinate is verified — is the coverage matrix in
[`architecture-evidence-coverage.md`](architecture-evidence-coverage.md), executed by
`tests/architecture_statement_coverage.test.ts`. Still refused, by design: a bare
`Questions` heading, a heading whose label is not its leading phrase, tables in any
format, and a paragraph separated by a blank line from a colon-opened list.

## The coordinate

Every record cites the block it was read from and the coordinate that block's format
has. A `line_span` block's lines map one to one onto the file's lines, so a statement on
unit *k* of a Markdown block cites line `line_start + k` exactly; the tests read that
line back from the file and check it holds the excerpt; a labelled field that continues
over following lines cites the whole span, never past the block. Every other locator kind —
`docx_block`, `pptx_shape`, `spreadsheet_cell`, `pdf_page_block`, `notebook_cell`,
`html_node`, `csv_row` — is cited verbatim, with `unit_index` and `unit_count` beside it
saying which lines of the block's text the statement occupies. No format is given a line
number it does not have (ADR-043).

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
  "unit_index": 0, "unit_count": 1,
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
    "profile_id": "architecture-development/v2",
    "roles": ["wip_proposal"],
    "role_evidence": [{"role": "wip_proposal", "predicate": "work.kind", "object": "proposal", "assertion_id": "assertion:…", "count": 1}, …],
    "selected": true,
    "selected_for_roles": ["wip_proposal"],
    "reasons": ["wip_proposal selects constraint: work.kind=proposal (assertion:…), work.status=wip (assertion:…)"]
  },
  "epistemic_class": "source-declared",
  "authority_verified": false,
  "extractor_id": "architecture-statements/v1", "extractor_version": "1.1.0", "profile_version": "1.3.0"
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

`architecture-development/v2` is a view over the records, not a filter and not a
vocabulary. It reads what the document already declared about itself — `work.kind`,
`work.status`, and whether it carries tasks, blockers or dependencies — assigns roles
from a static table, and marks which classes a reader of that role is looking for.

| Role | Established by | Selects |
|---|---|---|
| `wip_proposal` | `work.kind` in `design`, `plan`, `proposal`, `roadmap`; or `work.status` in `draft`, `planned`, `wip` | all five classes |
| `specification` | `work.kind` in `decision`, `specification` | `constraint`, `decision_statement` |
| `development_handoff` | `work.kind` `checklist`; or any `work.task.open`, `work.task.completed`, `work.blocked_by`, `work.depends_on` | `constraint`, `open_question` |
| `research_notes` | `work.kind` in `notes`, `research` | all five classes, deliberately recall-oriented |
| `unknown` | no rule above matched | all five classes |

The policy is `architecture-development/v2` and the manifest carries every rule under
`selection_policy`, so a reason on a record can be checked against the row that produced
it. The vocabulary is closed: every role is established by one of the declarations in the
table and nothing else establishes one.

**A role is a retrieval-selection classification, not a lifecycle judgement.** A
declared `work.status` is a separate axis that the record carries under
`work_context.statuses` and `work_context.applicability` and the query filters with
`--status`. An archived specification is a `specification` whose declared status is
`archived`; there is no `historical` role, and nothing is read as historical because a
file is old, sits under `archive/`, carries a date, or names a successor. Equally,
`status: active` or `done` establishes no role and no authority. `wip_proposal` is a
legacy selection-family name: matching a `plan` kind says what the document is for, not
that it is unfinished today; its declared status says that, separately. Research and
notes are `research_notes`, never `wip_proposal` by kind alone; a research document that
also declares `status: wip` is both.

Roles overlap and there is no priority among them. A record's `selection.selected` is
true when at least one of its document's roles selects its class, and
`selection.selected_for_roles` names exactly which: the matched roles whose rule selects
that class, in code-point order, derived from the same typed rule evaluation as the
reasons and never from their text. In a document that is both a `specification` and a
`development_handoff`, a `constraint` is selected for both, an `open_question` for the
handoff only, and a `decision_statement` for the specification only; all three are
`selected`, and a question "selected for specification documents" is answered from
`selected_for_roles`, never from `roles` plus `selected`. `selection.reasons` names,
for each selecting rule, the predicate, object and assertion id that established the
role. An unselected record has an empty reason list and an empty `selected_for_roles`: no
rule selected it, nothing judged it. A document matching no rule is `unknown`, carries no
role evidence, selects every class, and says why on every record: "no supported
document-role rule matched the available source declarations; all observed architectural
classes remain selected to preserve recall" — which is not a claim that the document
declared nothing; a document that declares only `Status: archived` is unknown too, and
that status stays on its records.

`selected_for_roles` was added in profile 1.3.0. A payload written before it recorded only
`selected`; the verifier does not fault such a payload for lacking the field, and the
query will not reconstruct it (see `corpus-evidence-query.md`). A policy change moves the
profile hash and `corpus_analysis_id`; it never moves an unchanged statement's
`evidence_id`, the source snapshot, a packet id or a cache key: `selection` is derived
metadata, not part of the statement's identity. `work_context.applicability` carries the document's
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
| `selected_record_count`, `by_class`, `by_format`, `by_role`, `by_recognition_form` | totals the records must support; `by_role` counts document-role membership, not selection |
| `selection_policy` | every rule the selection applied, so a reason or a `selected_for_roles` entry can be checked against its row |
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
