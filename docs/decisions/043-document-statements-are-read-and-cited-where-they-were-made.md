# ADR-043: A decoded document's statements are read, and cited where they were made

## Status

Accepted. Completes
[ADR-042](042-binary-document-decoding-generational-publication-and-bounded-candidate-work.md),
which decoded PDF, DOCX, PPTX, XLSX, IPYNB, CSV and HTML into blocks and
deliberately stopped short of interpreting them. Extends
[ADR-040](040-semantic-candidate-discovery-and-reasoning-handoff.md) (candidate
discovery) and
[ADR-041](041-corpus-source-identity-verification-class-and-partial-corpora.md)
(split identities). None is superseded.

## Date

2026-08-23

## Context

ADR-042 recorded one item as deliberately not done:

> Interpretation of binary document formats. The work-signal extractors cite line
> spans. A Word document has no lines, and running them over joined block text
> would produce exactly the fabricated line numbers the contract forbids.

The reasoning about line numbers was right. The conclusion drawn from it was not.

The consequence was a corpus that decoded a Word document, tokenized it, matched
it against its Markdown twin, counted it in coverage — and reported it as having
said nothing. `interpreted_count` was structurally zero for every format without
lines, and the operator's own report showed statuses, tasks, blockers and
dependencies read out of the Markdown in an archive and out of none of the Word
documents, decks or spreadsheets beside it. On the disks this tool exists for,
that is most of the archive. A reader of the report could not tell the difference
between "these plans declare nothing" and "these plans were never read".

Three further defects were found while closing it, each the same shape — a field
that named something more specific than it held:

- **The document index named one decoder for every format.** `decoder_id` and
  `decoder_version` were passed once and stamped on every row, so a `.docx` entry
  said the text decoder had read it. The `normalized_document_id` derived from
  the same fixed decoder, and that id is the join key between the index, the
  cache and every piece of evidence — so three things that had to agree were
  computed from a decoder that had not run.
- **An incremental scan recorded a different inventory from a full one.** The
  `unsupported_encoding` observation — "this file is not valid UTF-8 and is
  observed by hash only" — was pushed only on the freshly-hashed path. Carrying a
  prior run's hash forward probed the encoding, held the result, and dropped the
  finding. The inventory is part of the Repository Model Packet, so an
  incremental scan of an untouched disk holding one Word document produced a
  different packet semantic hash, and through it a different corpus source
  snapshot id, than a full scan of exactly those bytes.
- **The CSV decoder's smallest unit was the row.** `csv_row` has carried an
  optional `column` since it was defined and nothing ever set it. A row block's
  text is a rendering of the whole row — `owner: mel; status: blocked` — and a
  reader looking for a declaration finds `owner` and stops. The identical table
  in a worksheet was understood, because the worksheet decoder emits cells.

## Decision

**A statement is recognized once and located twice.** The work-intelligence
recognizers — status, kind, task, milestone, and the declared relations — are
refactored to return a `SignalReading` carrying no position at all. Two callers
attach the coordinate their own source has: the line-oriented extractor attaches
a line span, and a new block reader attaches the block id and the structured
locator the decoder emitted. There is one implementation of "what is a status
declaration", so a `.docx` plan and the `.md` copy beside it cannot be found to
say different things.

**Block-bound evidence is its own type, and stays in the corpus layer.**
`DocumentBlockAssertion` binds artifact id, raw content hash, normalized document
id, decoder id and version, block id, structured locator, bounded excerpt,
predicate and object. It is deliberately not `InterpretedAssertion`: that type's
evidence is a line span and it is what the Repository Model Packet carries, so a
`pptx_shape` locator has no meaning to a consumer promised line numbers. These
assertions reach readiness, the semantic passes, coverage, the corpus index and
the operator's report — and not the packet. The Topology contract is unchanged
and no dispatch is made.

**A decoded block never borrows a coordinate it does not have.** No block signal
cites a `line_span`. The one structured locator that carries line numbers is
`notebook_cell`, where they are lines of that cell, which the file really has.

**The document index becomes `l9.document-index/v2`**, and per-root coverage
`l9.document-coverage/v2`. Each entry names the decoder that read it, the format
it was read as, its block count and its locator type; the index names every
decoder profile in the registry rather than one. This is not an addition to what
v1 meant — it corrects what v1 said, and a reader must be able to tell an index
whose decoder fields are accurate from one whose are not.

**`document-signals.json` becomes `l9.document-signals/v1`** and carries the
evidence records themselves, not only counts. The listing is bounded per format;
the counts beside it are complete, and the difference is stated as
`omitted_signal_count` rather than left to subtraction.

**The report states what was understood.** `corpus-report.md` gains exact
observation, per-format decoding, intelligence and embedding sections, so an
operator can distinguish "we inspected this and found nothing" from "we could not
understand this" without opening two JSON files and joining them by hand. The
decoding table prints eligible, decoded and *understood* side by side, which is
where a decoder wired to nothing becomes visible.

**The block-reading rules are a profile, and the profile enters the analysis
identity.** `document_block_profile` sits beside `interpretation_profile` in
`CorpusAnalysisIdentity` rather than being folded into it, because the two answer
the same question about different sources and a change to either must not
invalidate both.

## Consequences

The corpus now reports what an operator's Word documents, decks, spreadsheets,
notebooks, PDFs, saved pages and registers state about themselves, at a
coordinate that can be checked against the source.

`corpus_analysis_id` moves for every corpus, because a new profile participates
in it and more is now concluded. `corpus_source_snapshot_id` does not move for
any corpus of text files; it moves for a corpus containing non-UTF-8 files
previously scanned incrementally, because those scans were recording an inventory
that a full scan of the same bytes did not produce. That is a correction, and the
full scan was the correct one.

The CSV decoder moves to 1.1.0 and emits a block per populated cell beside the
row block, so its cached documents are recomputed once.

What is still not done, and is now stated as a bounded gap rather than a
category:

- **Legacy containers** — `.doc`, `.xls`, `.ppt`, `.odt`, `.epub`, `.pages`,
  `.rtf`. Different containers from the OOXML ZIP the shipped decoders read.
  Counted explicitly, with their byte totals.
- **OCR.** A scanned PDF is opened, found to have no text layer, and reported as
  `decoder.ocr_required`. That is a different finding from a decode failure and
  from a format nothing claims.

## Alternatives considered

**Widen `InterpretedAssertion` to hold either coordinate.** Rejected: it is the
Repository Model Packet's evidence type, and a consumer bound to that contract
promises to understand line spans. Pushing eight locator shapes into it would
break a contract this pull request has no authority to change.

**Give binary blocks synthetic line numbers over their joined text.** Rejected
for the reason ADR-042 gave, which remains correct: a plausible line number looks
checkable and is not, and is worse than no evidence at all.

**Leave the statements in `document-signals.json` alone.** Rejected: the corpus
index and the operator's report are built from the work-signal list, so a corpus
whose report shows three blocked plans and omits the twenty Word documents beside
them has answered the question wrong rather than partially.
