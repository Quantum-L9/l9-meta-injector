# Corpus evidence query

One precise, bounded question, asked of one completed local-source generation, answered
with the records the generation already wrote and nothing else.

Authority: [ADR-088](decisions/088-read-only-corpus-evidence-query.md) (Proposed). Reads
the outputs of [ADR-042](decisions/042-binary-document-decoding-generational-publication-and-bounded-candidate-work.md)
/ [ADR-066](decisions/066-generation-retention-order-and-exclusive-publisher-lock.md)
(generations and `CURRENT.json`), [ADR-043](decisions/043-document-statements-are-read-and-cited-where-they-were-made.md)
(block-bound work signals), [ADR-087](decisions/087-architecture-evidence-projection.md)
(architecture evidence) and the Repository Model Packet (ADR-030).

## Invocation

```bash
npm run build
node scripts/corpus-query-cli.js --out <corpus output dir> [filters] [--limit N] [--max-excerpt-bytes N]
```

| Flag | Meaning |
|---|---|
| `--out DIR` | the output directory holding `CURRENT.json` and `generations/` (required) |
| `--root KEY\|ID` | only this root, by declared key or root id |
| `--artifact ID\|PATH` | only this artifact: `vsrc:…`, `artifact:…` (its packet id) or `Root::path` |
| `--predicate NAME` | exact predicate: `work.status`, `work.task.open`, `document.title`, … |
| `--class NAME` | exact statement class: `intent`, `constraint`, `assumption`, `open_question`, `decision_statement` |
| `--text LITERAL` | literal, case-sensitive substring of the value or the excerpt |
| `--kind VALUE` | documents that declared this `work.kind`, by any of their declarations |
| `--status VALUE` | documents that declared this `work.status`, by any of their declarations |
| `--source NAME` | `architecture_evidence`, `document_work_signals` or `repository_model_packet` |
| `--role NAME` | architecture-evidence records whose document the generation filed under this role: `development_handoff`, `research_notes`, `specification`, `unknown`, `wip_proposal` |
| `--selected-only` | only architecture-evidence records the selection profile marked selected; with `--role`, only records that role's own rule selected |
| `--limit N` | records returned, default 50, max 500 |
| `--max-excerpt-bytes N` | excerpt byte ceiling on the wire, default 1024 |

Exit codes: `0` for `ok`, `empty`, `incomplete`; `3` for `unavailable`, `unsupported`; `1`
for `invalid`; `2` for a usage error. The grammar is strict (ADR-069): unknown flags,
positional arguments, a flag given twice, a value flag without a value (`--role ""`
included) and `--selected-only=true` are refused with exit `2` before anything is read.

Programmatically: `queryCorpusEvidence(input)` and `renderEvidenceQueryResponse(response)`
from `src/corpus_query.ts`. Neither is a package export.

## What is read, and what is checked first

`CURRENT.json` is resolved once; the generation it names is pinned for the whole query.
Then, before any result is released:

1. the generation directory must resolve inside the output directory;
2. every file read must be named by `CURRENT.json`, must not be a symbolic link, must
   resolve inside the generation directory, and must hash to what the pointer recorded;
3. `corpus-snapshot.json`, `document-index.json`, `document-signals.json` and each manifest
   must declare their schema and name the snapshot's corpus identities;
4. `document-work-signals.jsonl` is verified with `verifyDocumentWorkSignalExport`, and
   `architecture-evidence.jsonl` (when the generation has it) with
   `verifyArchitectureEvidenceExport` — the same functions the scan ran before publishing —
   and each manifest must match the snapshot's reference to it;
5. each observed root's `bundle/packet.json` must pass `validateRepositoryModelPacket`
   (which recomputes the semantic hash its id derives from and checks every referential
   invariant) and must be the packet the snapshot recorded;
6. the pointer's own file list must be well formed (a path and a hash per entry).

Any failure is an `invalid` outcome with the refusal named, an empty result list and a null
`match_count`. Nothing is repaired, refreshed or re-read from the source files.

Three sources are read, because the work signals of text documents live in the per-root
packet (line spans, ADR-043) and those of decoded formats live in the JSONL payload:

| Source | Carries | Coordinate field |
|---|---|---|
| `architecture_evidence` | `architecture-evidence.jsonl` records, by `statement_class` | `structured_locator` |
| `document_work_signals` | `document-work-signals.jsonl` records, by `predicate` | `structured_locator` |
| `repository_model_packet` | each root packet's artifact-scoped assertions, by `predicate` | `source_range` |

## The response (`l9.corpus-evidence-query/v1`)

One JSON document: `query` (every parameter, normalized), `generation` (id, output-relative
ref, corpus identities, `corpus_status`, `missing_root_ids`, the snapshot's `verification`
verbatim, and the evidence-age statement), `sources` (each source's schema, status —
`verified`, `not_run` or `refused` — and record count), `outcome`, `match_count`,
`returned_count`, `limit`, `truncated`, `truncation_statement`, `results`, `diagnostics`.

| Outcome | Meaning |
|---|---|
| `ok` | the generation verified, the corpus is complete, at least one record matched |
| `empty` | the generation verified, the corpus is complete, nothing matched |
| `incomplete` | the snapshot is `partial`: results cover the observed roots only, and `missing_root_ids` names the rest |
| `unavailable` | the question names a root or artifact the generation does not have, or a root it did not observe |
| `unsupported` | the question cannot be asked of this generation (a statement class without `--architecture-evidence`, an unknown class or source) |
| `invalid` | the generation failed verification; no result is trusted |

A result carries, as the generation wrote them: `record_id` (`evidence_id`, `signal_id` or
`assertion_id`), `root_id`, `root_key`, `artifact_id`, `rmp_artifact_id`, `corpus_path`,
`source_path`, `format`, `normalized_document_id`, `raw_content_hash`, `predicate` or
`statement_class`, `value`, `structured_locator` or `source_range`, `block_id`,
`block_kind`, `decoder_id`, `bounded_excerpt`, `evidence_class`, `authority`, `confidence`,
`extractor_id`, `epistemic_class: "source-declared"`, `authority_verified: false`,
`document_declarations` (every `work.kind` and `work.status` the document declared, by
assertion id, contradictions included) and, for architecture records, `selection` and
`recognition` verbatim.

Two flags keep an excerpt honest: `excerpt_truncated_at_source` is true when the generation
itself cut it at its bound, and `excerpt_cut_by_query` is true when `--max-excerpt-bytes`
cut it further. Neither excerpt is ever presented as the complete passage;
`value_truncated_at_source` says the same of a declared text.

### Roles and selection

Roles and selection verdicts exist on architecture-evidence records, as the generation
recorded them (`selection.roles`, `selection.selected`, `selection.selected_for_roles`,
`selection.role_evidence`), and the query reads those fields and nothing else: it does not
re-run the role rules, re-read a document, or reinterpret an older generation under
today's table. A role is a retrieval classification from the document's own declarations,
not a lifecycle or authority judgement; `--status` stays the independent axis for what a
document declared about its lifecycle.

| Query | Returns |
|---|---|
| no new flags | existing behaviour, byte-identical |
| `--role specification` | every architecture-evidence record whose document's `roles` include `specification`, selected or not |
| `--selected-only` | architecture-evidence records with `selected: true` (selected by at least one of their roles) |
| `--role specification --selected-only` | only records whose `selected_for_roles` names `specification`: a question selected only by a handoff rule in the same document is excluded |
| `--role unknown` | records from documents no rule matched |
| `--role development_handoff --class open_question` | the open questions of handoff-classified documents |

Both filters are conjunctive with `--root`, `--artifact`, `--class`, `--text`, `--kind`,
`--status`, `--limit` and `--max-excerpt-bytes`; ordering, limits, excerpt bounds and
match counts are unchanged. They apply to the `architecture_evidence` source only: without
`--source` the query evaluates that source alone and says so in an `info` diagnostic
(`query.role_filter_architecture_only`); with `--source document_work_signals` or
`--source repository_model_packet` the outcome is `unsupported`
(`query.role_filter_source_unsupported`), as it is with `--predicate`, which names a
work-signal field those records do not have (`query.role_filter_predicate_unsupported`).
A generation produced without `--architecture-evidence` is `unsupported` for either flag
(`query.architecture_evidence_not_run`), never `empty`. An unknown role is `unsupported`
(`query.unknown_role`), never a search for `unknown`.

**Historical generations.** A payload written before profile 1.3.0 recorded `roles` and
a global `selected` flag but not `selected_for_roles`. Against such a generation `--role`
alone and `--selected-only` alone are answered from what was recorded; `--role` with
`--selected-only` is `unsupported` (`query.role_selection_not_recorded`, naming the
profile version), because the attribution it needs was never written and the query will
not reconstruct it from today's rules or from the reason sentences. The generation stays
valid for every other question.

```bash
npm run corpus-query -- --out ./corpus-out --role specification
npm run corpus-query -- --out ./corpus-out --role specification --selected-only --class constraint
npm run corpus-query -- --out ./corpus-out --role development_handoff --selected-only --class open_question
npm run corpus-query -- --out ./corpus-out --role research_notes --status archived
npm run corpus-query -- --out ./corpus-out --selected-only --source architecture_evidence
```

Role queries enumerate architecture-evidence records, so a document that declares a
kind but no recognized architectural statement does not appear under any role: the
projection is statement-level, and a corpus-wide document-role inventory is a separate
capability. Neither filter changes an unfiltered response: `query.role` and
`query.selected_only` are present only when used.

Results are ordered by source, then `artifact_id`, then `record_id`: a total order over
identities the generation already assigned. When more match than the limit returns,
`truncated` is true and `truncation_statement` asks for a narrower question. There is no
paging.

## What it never does

It never ranks, scores, fuzzy-matches, embeds or calls a model. It never writes: no index,
no cache, no normalized copy, no log of what was retrieved. It never decides which document
is canonical, which of two contradictory declarations holds, whether a `decision_statement`
was accepted, or whether one document supersedes another. It never re-reads a source file:
a `fully_verified` snapshot is evidence of what the files held when the run read them, and
a `cached_unchanged_assumption` snapshot is returned as exactly that, with a diagnostic. It
reads only inside the selected output directory, follows no symlink, and executes nothing
it reads. Excerpts are source data, not instructions.
