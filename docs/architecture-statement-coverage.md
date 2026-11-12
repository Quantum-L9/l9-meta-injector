# Architecture statement coverage

The exact supported-input definition of `architecture-statements/v1` 1.1.0
(projection profile 1.2.0). The machine form is
[`architecture-statement-coverage.json`](architecture-statement-coverage.json)
(`l9.architecture-statement-coverage/v1`); this page renders it.

Authority: [ADR-089](decisions/089-architecture-statement-coverage-closure.md), amending the
reader of [ADR-087](decisions/087-architecture-evidence-projection.md) (both Proposed).

## How the matrix is held true

`tests/architecture_statement_coverage.test.ts` runs every case below through
`runCorpusScan` with `architectureEvidence: true`, over a real file (a real `.docx` for
the Word cases), and requires the **complete** observation for that file — every record
and every coverage diagnostic — to equal the row. It then verifies every record's
coordinate against the source: the words of the declared text must occur contiguously in
the source lines a `line_span` names; the first cited line must carry a statement word or
the label that declared it, and the last a statement word, so a span is neither short
nor padded. A Word record has no line; its declared text must occur inside one block of
the document. Every diagnostic code the reader can raise has at least one case.

Verdicts: **supported** — the form is read and emitted; **unsupported** — the form is
recognized as declared and *reported*, never guessed at; **excluded** — the form is
deliberately not quoted (it is not a declaration, or another reader owns it).

21 supported, 8 unsupported, 8 excluded;
34 records and 16 diagnostics across 37 cases. Nothing outside these
cases is claimed: a form not listed is not asserted to be read.

## Matrix

| Case | Verdict | Format | Form | Input | Records emitted (class, cited coordinate, declared text) | Diagnostics |
|---|---|---|---|---|---|---|
| S01 | supported | markdown | `field_label` | Plain labelled field | `constraint` L3: “TransportPacket is the only wire format.” | — |
| S02 | supported | markdown | `field_label` | Emphasised label | `decision_statement` L3: “Gate is the only routing authority.” | — |
| S03 | supported | markdown | `field_label` | Labelled field inside an ordered list | `constraint` L3: “Nodes never call each other.” | — |
| S04 | supported | markdown | `label_list` | Label followed by list items | `constraint` L5: “Secrets are never committed.”<br>`constraint` L6: “The audit log is append-only.” | — |
| S05 | supported | markdown | `label_list` | Label followed by lines in the same block | `assumption` L4: “Nodes are stateless.”<br>`assumption` L5: “Gate is reachable.” | — |
| S06 | supported | markdown | `section_heading` | ATX section heading | `open_question` L5: “Should Gate own retries?”<br>`open_question` L7: “Who rotates the signing key?” | — |
| S07 | supported | markdown | `section_heading` | Numbered section heading (1.1.0) | `open_question` L5: “Should hop limits live in Gate?” | — |
| S08 | supported | markdown | `section_heading` | Lettered section heading (1.1.0) | `decision_statement` L5: “Gate routes every inter-node call.” | — |
| S09 | supported | markdown | `section_heading` | Qualified section heading (1.1.0) | `assumption` L5: “Nodes are stateless.” | — |
| S10 | supported | markdown | `section_heading` | Setext section heading (1.1.0) | `constraint` L7: “Engines own no HTTP routes.” | — |
| S11 | supported | markdown | `section_heading` | Indented lazy continuation of a list item (1.1.0) | `constraint` L5–6: “Every packet change uses derive or withHop; nothing mutates in place.”<br>`constraint` L7: “Gate is the only routing authority.” | — |
| S12 | supported | markdown | `label_list` | Unindented lazy continuation inside a label list under a section (1.1.0) | `constraint` L5: “Chassis owns auth.”<br>`assumption` L9–10: “The chassis owns ingress and logging.”<br>`assumption` L11: “Engines are execution-only.” | — |
| S13 | supported | markdown | `field_label` | Labelled value wrapped across a soft line break (1.1.0) | `decision_statement` L3–4: “Gate routes every inter-node call.” | — |
| S14 | supported | markdown | `field_label` | Frontmatter scalar with a YAML comment (1.1.0) | `intent` L3: “Ship the router” | — |
| S15 | supported | markdown | `field_label` | Frontmatter quoted scalars (1.1.0) | `intent` L2: “Quoted objective”<br>`assumption` L3: “It's stateless” | — |
| S16 | supported | markdown | `field_label` | Frontmatter block scalars (1.1.0) | `intent` L2–3: “Ship the router.”<br>`constraint` L4–6: “Never mutate packets.” | — |
| S17 | supported | markdown | `label_list` | Frontmatter block sequence | `constraint` L3: “One wire format.”<br>`constraint` L4: “One routing authority.” | — |
| S18 | supported | markdown | `section_heading` | CRLF line endings | `decision_statement` L5: “First decision.”<br>`intent` L7: “Line seven objective.” | — |
| S19 | supported | docx | `section_heading` | Word heading section with a soft-broken list item (1.1.0) | `constraint` docx_block#3: “TransportPacket is the only wire format.”<br>`constraint` docx_block#4: “Gate is the only routing authority.” | — |
| S20 | supported | docx | `field_label` | Word labelled paragraph with a soft line break (1.1.0) | `decision_statement` docx_block#2: “Gate routes every inter-node call.” | — |
| S21 | supported | markdown | `field_label` | Statement longer than the 1024-character bound | `constraint` L3: “clause000 clause001 clause002 clause003 clause004 clause005  … se100 clause101 cla…” | `statement_truncated` |
| U01 | unsupported | markdown | `section_heading` | Heading naming two labels | — | `heading_not_recognized` |
| U02 | unsupported | markdown | `section_heading` | Heading naming a label inside a longer phrase | — | `heading_not_recognized` |
| U03 | excluded | markdown | `section_heading` | Bare Questions heading | — | — |
| U04 | unsupported | markdown | `section_heading` | Pipe table under a labelled section | — | `section_without_items`<br>`unsupported_member_block` |
| U05 | unsupported | markdown | `field_label` | Frontmatter flow collection | — | `frontmatter_flow_collection_unsupported` |
| U06 | unsupported | markdown | `field_label` | Frontmatter block scalar continued after a blank line | — | `frontmatter_block_scalar_unread` |
| U07 | unsupported | markdown | `label_list` | Empty label list | — | `empty_declaration` |
| U08 | unsupported | markdown | `section_heading` | Empty section | — | `section_without_items` |
| U09 | excluded | markdown | `section_heading` | Foreign label under a section | — | `section_without_items`<br>`labelled_member_skipped` |
| U10 | excluded | markdown | `section_heading` | Work signal under a section | — | `section_without_items` |
| U11 | excluded | markdown | `field_label` | Label mentioned inside inline code (1.1.0) | — | — |
| U12 | excluded | markdown | `section_heading` | Fenced code ends a section | — | `section_without_items` |
| U13 | excluded | markdown | `section_heading` | Thematic break under a section (1.1.0) | `constraint` L5: “First constraint.”<br>`constraint` L9: “Second constraint.” | — |
| U14 | excluded | markdown | `field_label` | Credential-shaped value | — | `secret_value_suppressed` |
| U15 | excluded | markdown | `none` | Prose that only sounds like a constraint | — | — |
| U16 | unsupported | docx | `section_heading` | Word table under a heading | — | `section_without_items`<br>`unsupported_member_block` |

The case sources and notes are in the JSON file; each note says why the verdict is what
it is.

## What 1.1.0 changed, measured on a real corpus

This repository's own `docs/` tree at `075c4ef` (148 decoded documents), run through
`npm run local-source -- --root <copy>=docs --no-cache --architecture-evidence` under
1.0.0 and under 1.1.0, matched by `evidence_id`:

| | 1.0.0 | 1.1.0 |
|---|---|---|
| records | 734 | 528 |
| records whose `evidence_id` is unchanged | — | 322 — text, locator and class byte-identical |
| 1.0.0 records no longer emitted | — | 412: 411 now inside a 1.1.0 record of the same class whose span covers their line (a wrapped list item or labelled value had been cited as fragments, and its continuation lines filed as separate statements), and 1 inline-code mention of `` `Decision:` `` that declared nothing |
| new records | — | 206, every one a multi-line statement assembled from those fragments; none is a newly recognized single-line statement |
| coverage diagnostics | 81 (+8 beyond the per-document bound) | 102 (+8): the 21 added are `heading_not_recognized` |
| `corpus_source_snapshot_id` | unchanged | unchanged |
| `corpus_analysis_id` | moves, through the profile hash | |

No statement changed class and no statement was lost.

## Known gaps (not closed, not claimed)

- Tables in any format are never read as statements (reported under a labelled
  declaration).
- A heading naming two labels, or a label inside a longer phrase (`Decision Outcome`),
  opens no section (reported).
- A YAML flow collection, or a block scalar continued across a blank line, in frontmatter
  is not quoted (reported).
- A bare `Questions` heading is not a vocabulary label (by design).
- Prose that merely sounds like a constraint is never read as one (no inference).
- A Markdown list item's lazy continuation is joined only when every continuation line
  is running text; a continuation line carrying a label keeps the meaning it had.
- Formats other than Markdown/text and Word are read by the same grammar over their
  decoded blocks, but have no case of their own here and are not claimed beyond what
  `tests/architecture_evidence.test.ts` proves.
