# Architecture evidence — coverage matrix

The exact supported-input definition of `architecture-statements/v1` (1.1.0): every
written form the reader recognizes, what each yields, and every construct it refuses.
This table is executed by `tests/architecture_statement_coverage.test.ts`, which reads
the same forms from real files through the real scan and checks each record's
coordinate against the lines that hold it. A form not in this table is not supported,
whatever it looks like.

Semantics: [`architecture-evidence.md`](architecture-evidence.md). Authority: ADR-087
(Proposed).

## Supported forms

| Form (`recognition.form`) | Written as | Emits | Coordinate | Since |
|---|---|---|---|---|
| `field_label` | `Objective: …`, `Decision: …`, `- Constraint: …`, `**Assumption:** …` — a `Label: value` line with a vocabulary label and a non-empty value | one statement; `declared_text` is the value | the line (`line_span`), or the block locator with `unit_index` | 1.0.0 |
| `field_label` continuation | the non-empty lines that follow a labelled field inside the same block (a soft-wrapped Markdown paragraph, a Word paragraph's line breaks) until the next label, work signal, table row or block end | folded into that statement; `unit_count` > 1 | `line_span` widened from the label's line to the last continuation line, never past the block | 1.1.0 |
| `label_list` | `Constraints:` with nothing after the colon, then the remaining lines of the same block, else the consecutive `list_item` blocks that follow | one statement per member | each member's line | 1.0.0 |
| `section_heading` | a `title` or `heading` block whose text is a vocabulary label: `## Open Questions` | one statement per `list_item` (per line) and per `paragraph` or `note` block (whole block), until the next heading, title or code block | the item's line; the paragraph's block | 1.0.0 |
| `section_heading`, numbered or qualified | `## 2. Open Questions (v2)`, `## Decisions — phase 1`, `## Constraints: transport`, `## 3.1 Invariants` — a leading section number and a qualifier after `(`, `—`, `–`, ` - ` or `:` are not part of the label | as above | as above | 1.1.0 |
| `section_heading`, pseudo-heading | a single-line `paragraph` that is a bare vocabulary label in emphasis (`**Decisions**`, `__Constraints__`) or with a section number (`3.1 Invariants`), optional trailing colon | as above | as above | 1.1.0 |
| `frontmatter_field` | `decision: …`, `objective: …` between the leading `---` fences of a text file (the first `line_span` block, starting at line 1) | one statement; `declared_text` is the value | the field's line | 1.1.0 |

Every form is read from the normalized blocks of every decoder, so a Word `Heading 1`
reading `3. Invariants (transport)` and a Markdown `## 3. Invariants (transport)` are the
same section. Decoded formats cite their block locator verbatim with `unit_index` and
`unit_count` beside it; only `line_span` is narrowed to lines.

## Refused constructs

| Construct | Outcome | Diagnostic |
|---|---|---|
| a line the work vocabulary claims (`Status: wip`, `- [ ] task`, `Depends on: …`) under a declaration | skipped silently; it is a work signal | — |
| a `Label: value` line under a declaration whose label is in neither vocabulary (`Owner: mel`) | skipped | `architecture_evidence.labelled_member_skipped` |
| a table (`table` block or a Markdown pipe table) under a declaration | skipped | `architecture_evidence.unsupported_member_block` |
| `Constraints:` (or `**Constraints**`) with nothing attributable after it | — | `architecture_evidence.empty_declaration` |
| `## Decisions` with no attributable item or paragraph | — | `architecture_evidence.section_without_items` |
| a `code` block or fenced code, anywhere | never read; ends an open section | — |
| a statement whose text resembles a credential | dropped, never redacted | `architecture_evidence.secret_value_suppressed` |
| a statement over 1024 characters | cut, `declared_text_truncated: true` | `architecture_evidence.statement_truncated` |
| a bare `Questions` heading, `Goal of this section`, or any heading whose label is not the leading phrase | not a section; no statement | — |
| a plain `Constraints:` line | a `label_list` opener, never a section (unchanged since 1.0.0) | — |
| a `---` block that is not the file's first block, or not at line 1 | a thematic break, not frontmatter | — |
| a paragraph after `Constraints:` separated by a blank line | not a member (only list items follow a colon-opened list) | `architecture_evidence.empty_declaration` when nothing else follows |
| a sentence whose colon prefix happens to match the label shape (`Hop limits are enforced: by Gate`) under a section | treated as a foreign label | `architecture_evidence.labelled_member_skipped` |

Diagnostics are bounded at eight per document; `diagnostics_omitted` counts the rest.

## Identity across versions

`evidence_id` is `stableId("architecture_evidence", {artifact_id, block_id, declared_text,
extractor_id, recognition_form, statement_class, unit_index})`. No version enters it, so a
statement the 1.1.0 rules read exactly as 1.0.0 did keeps its id. Ids move only where the
reading changed: a labelled field that now absorbs continuation lines (its `declared_text`
grew), a statement under a numbered or qualified heading that 1.0.0 did not open (new
record), a frontmatter field (new record). `extractor_version`, `profile_version` and the
profile hash move for every record, and the profile hash moves `corpus_analysis_id` for
every run that selects the projection; the source snapshot does not move.

## Locator verification

The matrix test reads each `line_span` record's `line_start`–`line_end` back from the file
it names and requires the span to contain the record's bounded excerpt and the first word
of its declared text; a Word record is required to cite a `docx_block` with `unit_index`
and `unit_count` and no line number. `architectureStatementLocator` is tested to widen
only within the block and to leave every non-line locator verbatim.
