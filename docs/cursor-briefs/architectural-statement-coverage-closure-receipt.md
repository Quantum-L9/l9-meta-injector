# Brief — Architectural Statement Coverage Closure (receipt)

Status snapshot for `architecture-statements/v1` 1.1.0, the coverage closure of the
five-class architecture-statement reader (ADR-087, Proposed). Stacked on PR #140 (the
evidence query), which is stacked on PR #139 (the projection). Owner surface:
`src/extractors/architecture_statements.ts`; the export in
`src/corpus_architecture_evidence.ts` only carries one new field.

## Revision binding

| Item | Value |
|---|---|
| Base | head of PR #140 (`claude-mobile/dazzling-feynman-azm517-retrieval`) |
| Branch | `claude-mobile/dazzling-feynman-azm517-coverage` |
| Head | the commit this brief ships in, plus the regenerated validation report |
| Versions | extractor 1.0.0 → 1.1.0; evidence profile 1.0.0 → 1.1.0; extractor id unchanged |

## Gaps closed (each bounded to one written form)

| Gap in 1.0.0 | Rule in 1.1.0 | Form | Example |
|---|---|---|---|
| a heading with a section number or qualifier was not a section | leading `\d+(\.\d+)*[.)]?` and a trailing qualifier after `(`, `—`, `–`, ` - ` or `:` are not part of the label | `section_heading` | `## 2. Open Questions (v2)`, `## Decisions — phase 1`, Word `3. Invariants (transport)` |
| a bold or numbered bare label on its own line was prose | a single-line paragraph that is a vocabulary label in emphasis or with a section number (optional trailing colon) opens a section; a plain `Constraints:` stays a `label_list` opener | `section_heading` | `**Decisions**`, `3.1 Invariants` |
| frontmatter keys were read as body labels | the first `line_span` block at line 1 fenced by `---` is frontmatter; vocabulary keys inside are statements of their own form, other keys are ignored | `frontmatter_field` | `decision: …` |
| a statement across a soft line break was quoted as its first line | non-empty lines after a labelled field inside the same block are its continuation until the next label, work signal, table row or thematic break; `unit_count` records the span and the `line_span` is widened within the block | `field_label` | `Assumption: … \n continues …` |

Still refused, by design and with a diagnostic where a declaration was opened: a bare
`Questions` heading; a heading whose label is not its leading phrase; tables in any
format; a paragraph separated by a blank line from a colon-opened list; fenced code; a
`---` block that is not the file's first block (a thematic break); work-vocabulary lines;
foreign `Label: value` lines; credential-shaped text.

## Coverage matrix

`docs/architecture-evidence-coverage.md` is the supported-input definition: every
supported form with what it emits and where it is cited, every refused construct with
its diagnostic, the identity rule and the locator verification method. It is executed by
`tests/architecture_statement_coverage.test.ts` (6 tests): one Markdown file carrying every
form at known lines, read through the real scan, with each record's `line_start`–`line_end`
read back from the file and required to hold the excerpt; one Word file with a numbered,
qualified heading, required to cite `docx_block` with `unit_index` and `unit_count` and no
line number; every refusal asserted to emit nothing but its diagnostic.

Emitted from the matrix file (line numbers are the cited coordinates):

| line(s) | form | label | class | declared text |
|---|---|---|---|---|
| 4 | `frontmatter_field` | decision | decision_statement | Frontmatter decisions are read too. |
| 8 | `field_label` | objective | intent | One field label on one line. |
| 10–11 | `field_label` (continuation, `unit_count` 2) | assumption | assumption | A field label whose statement continues on the next soft-wrapped line. |
| 14, 15 | `label_list` | constraints | constraint | the two list items |
| 19 | `section_heading` | open questions | open_question | under `## 2. Open Questions (v2)` |
| 21 | `section_heading` | open questions | open_question | the paragraph under the same heading |
| 25 | `section_heading` | decisions | decision_statement | under `**Decisions**` |
| 29 | `section_heading` | invariants | constraint | under `3.1 Invariants` |

Diagnostics raised by the same file: `empty_declaration` (`Unresolved:` with nothing
under it), `labelled_member_skipped` (`Owner: mel`), `section_without_items` twice (a
section holding only a table and a foreign label; a section holding only a fence),
`unsupported_member_block` (the table).

## Identity

`evidence_id = stableId("architecture_evidence", {artifact_id, block_id, declared_text,
extractor_id, recognition_form, statement_class, unit_index})`; no version enters it
(tested). A statement 1.1.0 reads as 1.0.0 did keeps its id. Ids move only where the
reading changed: a field that now absorbs continuation lines, a statement under a heading
1.0.0 did not open, a frontmatter field. The profile hash (and so `corpus_analysis_id` for
runs that select the projection) moves; the source snapshot, packets, work-signal payload
and cache keys do not.

## Validation

- Existing suites unchanged in outcome: `tests/architecture_evidence.test.ts` (21),
  `tests/corpus_query.test.ts` (20), `tests/corpus_cli.test.ts`, the work-signal export
  suite. The demonstration corpora of #139 and #140 carry no form whose reading changed.
- `npm run lint` and `npm run validate` green on this tree; the validation report is
  regenerated and bound to it.

## Remaining gaps

As listed under "Still refused". Reading a paragraph that follows a colon-opened list
after a blank line, and reading a Markdown pipe table's cells, would each need a rule
with no safe interpretation (which paragraph belongs to the list; which column is the
statement) and are left refused with their diagnostics.
