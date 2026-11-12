# Brief — Architectural Evidence Signals v1 (receipt)

Status snapshot for the opt-in architecture-evidence projection (ADR-087, Proposed).
A brief, not a GMP report: it records what this change is, what it reused, what it
measured, and what it leaves open. Authority for the semantics is
[`docs/architecture-evidence.md`](../architecture-evidence.md) and
[ADR-087](../decisions/087-architecture-evidence-projection.md).

## Revision binding

| Item | Value |
|---|---|
| Base (`origin/main`) | `f134e8d54dea51e94f94e6c4afb820931dbc9775` |
| Head | the commit this brief ships in (one feature commit plus the regenerated report) |
| Branch | `claude-mobile/dazzling-feynman-azm517` |
| History note | the branch was rebuilt once from the base before publication so that no commit carries a credential-shaped test literal (the fixture now uses `placeholder-value-never-issued`); the tree is the reviewed tree |

## Resolution of the current implementation

- Owners read: ADR-032/036 (acquisition and interpretation seams), ADR-037 (artifact-scoped
  work signals), ADR-041 (source versus analysis identity), ADR-042/066 (generational
  publication), ADR-043 (block-bound statements; one recognizer located twice), ADR-059
  (decoder dialect identity), ADR-068 (not-run versus found-empty), ADR-082 §6 (cacheable
  interpretation).
- Smallest existing owner: the block layer of ADR-043 (`src/extractors/document_blocks.ts`
  and `src/corpus_work_signal_export.ts`). The new reader is the architectural sibling of
  the block work-signal reader; the new export mirrors the work-signal export's contract.
- PR #138 is a docs evidence archive (D/E run). It changes no contract and was treated as
  history only.
- Not duplicated: the `Label: value` grammar (`readLabelledLine`, a new export of
  `work_intelligence.ts` with no behavior change), excerpt bounding and secret refusal
  (`interpretation.ts`), canonical JSON and hashing, artifact ids, the generation
  publisher, the document-index join.

## Surfaces reused and changed

| Surface | Reused | Changed |
|---|---|---|
| `src/extractors/work_intelligence.ts` | `readTextUnit`, `documentText` | additive export `readLabelledLine` (version stays 1.2.0) |
| `src/extractors/document_blocks.ts` | `DocumentBlockView` | — |
| `src/interpretation.ts` | `boundExcerpt`, `looksSecret`, `MAX_EXCERPT_LENGTH` | — |
| `src/corpus_scan.ts` | normalized blocks, `interpreted` and `blockSignals`, `normalizedDocumentIdOf`, `repositoryModelArtifactId` | step 4d; `architectureEvidence?: boolean`; result field; snapshot ref; refuse-before-publish |
| `src/corpus_roots.ts` | `corpusAnalysisId` | optional `architecture_evidence_profile`, hashed only when present |
| `src/corpus_snapshot.ts` | — | optional `architecture_evidence_profile` and `architecture_evidence` ref |
| `src/corpus_index.ts` | `KNOWN_DOCUMENTS` | two entries, `present: false` on a default run (ADR-068) |
| `scripts/local-source-cli.js` | output assembly, summary | `--architecture-evidence`; two outputs; summary line; fix of six coverage fields that printed `undefined` |
| New | — | `src/extractors/architecture_statements.ts`, `src/corpus_architecture_evidence.ts`, `tests/architecture_evidence.test.ts`, `docs/architecture-evidence.md`, ADR-087 |

## Statement classes and extraction rules (`architecture-statements/v1` 1.0.0)

| Class | Labels (emphasis removed, lowercased; a heading's trailing colon dropped) |
|---|---|
| `intent` | objective, objectives, goal, goals, intent |
| `constraint` | constraint, constraints, invariant, invariants |
| `assumption` | assumption, assumptions |
| `open_question` | open question, open questions, unresolved, unresolved question, unresolved questions |
| `decision_statement` | decision, decisions |

Forms, over normalized blocks (`code` and `table` blocks and Markdown pipe tables are never read):

1. `field_label` — a unit matching the work reader's `Label: value` grammar with a vocabulary label and a non-empty value; declared text is the value. Coordinate: the unit's exact line for `line_span`, the block locator plus `unit_index` otherwise.
2. `label_list` — a vocabulary label with an empty value; members are the remaining units of the same block, else the consecutive `list_item` blocks that follow; one statement per member.
3. `section_heading` — a `title` or `heading` block whose text is a vocabulary label; members are `list_item` (per unit), `paragraph` and `note` (whole block) and `cell` blocks until the next heading, title or code block.

Exclusions in every form: units the work vocabulary claims are skipped silently;
`Label: value` under an unknown label raises `labelled_member_skipped`; tables raise
`unsupported_member_block`; an empty label raises `empty_declaration`; an empty section
raises `section_without_items`; credential-shaped text is dropped with
`secret_value_suppressed`; text over 1024 characters is cut with `statement_truncated`.
Eight diagnostics per document, overflow counted.

## Selection profile (`architecture-development/v1`)

| Role | Established by (existing assertions, cited by id) | Selects |
|---|---|---|
| `wip_proposal` | work.kind in design, notes, plan, proposal, research, roadmap; or work.status in draft, planned, wip | all five |
| `specification` | work.kind in decision, specification | constraint, decision_statement |
| `development_handoff` | work.kind checklist, or any work.task.open, work.task.completed, work.blocked_by, work.depends_on | constraint, open_question |
| `unknown` | none of the above | all five |

Roles overlap and the selection is the union. Every record is emitted; `selection.selected`
and `selection.reasons` record the rule and the assertion that decided it. An unselected
record carries an empty reason list. The profile hash covers the reader's rules, the
selection table and the schema, and enters `corpus_analysis_id` only when selected.

## Before and after (synthetic mixed corpus: WIP proposal `.md`, specification `.docx`, handoff `.md`, untyped `.md`, diagnostics `.md`)

Default run, main's committed `dist/` against this branch's `dist/`:

| Output | Result |
|---|---|
| `corpus_source_snapshot_id` | identical |
| `corpus_analysis_id` | identical |
| packet ids, `document-index.json`, `document-signals.json`, `document-work-signals.jsonl` and manifest, candidates, readiness, coverage, bundles | byte-identical |
| `corpus-index.json`, `corpus-report.md` | two added rows listing the opt-in files as not written |
| wall-clock fields (`observed_at`, `created_at`) | differ per run, as before |

With `--architecture-evidence`: source snapshot identical; `corpus_analysis_id` moves; 16
statements in 4 of 5 documents, 15 selected, 6 coverage diagnostics; a warm cache serves
the newly selected projection with zero misses (tested).

## Validation

- `npm run lint` exit 0; `npm run validate` exit 0 (typecheck, 2922 tests passed, 5 skipped, 204 files; check:api, check:authority, check:manifest, check:dist, selfpack, test:packed, check:release-candidate). `CURRENT_VALIDATION_REPORT.md` regenerated and bound to this tree.
- New tests: 20 in `tests/architecture_evidence.test.ts` (developer queries answered from emitted records; line-exact source fidelity read back from the files; docx locator shape; selection reasons resolving to packet assertion ids; unselected-but-retained records; unknown role; identity invariance; cache invariance; deterministic replay; mount-point independence; index join; manifest refusal of a changed byte and of a promoted record; diagnostics) and 2 CLI cases in `tests/corpus_cli.test.ts`.
- Publish gate knobs and why: `PR_OVERLAP=ignore` because the only path overlapping open PR #138 is the generated, tree-bound validation report that every branch regenerates; `L9_CI_PARITY=0` because the governance Biome parity lane self-reports stale pins and blocks on tsc-generated `dist/` output, while org CI's `Analyze (central Core)` passed on PR #133, which changed 17 `src/` and `dist/` files with the same formatting. ESLint, the repository's declared owner for JS/TS, passes.
- Environment: the session container had a non-hoisting install; `npm ci` (as CI does) was needed for the pre-existing `ajv` import in `tests/metadata_index_migration.test.ts`.

## Sample emitted records

```json
{"statement_class": "intent", "declared_text": "Make every inter-node call pass through Gate so routing has one authority.", "recognition": {"form": "field_label", "label": "objective"}, "source_path": "plans/gate-routing-proposal.md", "format": "markdown", "structured_locator": {"kind": "line_span", "line_start": 7, "line_end": 7}, "unit_index": 0, "block_kind": "paragraph", "selection": {"roles": ["wip_proposal"], "selected": true, "reasons": ["wip_proposal selects intent: work.kind=proposal (assertion:a8c0d86d…), work.status=wip (assertion:3f75c33e…)"]}, "epistemic_class": "source-declared", "authority_verified": false}
```

```json
{"statement_class": "decision_statement", "declared_text": "Gate is the only routing authority.", "recognition": {"form": "field_label", "label": "decision"}, "source_path": "specs/transport-packet-spec.docx", "format": "docx", "structured_locator": {"kind": "docx_block", "block_index": 7, "part": "word/document.xml"}, "unit_index": 0, "block_kind": "paragraph", "selection": {"roles": ["specification"], "selected": true, "reasons": ["specification selects decision_statement: work.kind=specification (assertion:…)"]}, "epistemic_class": "source-declared", "authority_verified": false}
```

```json
{"statement_class": "constraint", "declared_text": "Engines contain no auth, routing or FastAPI routes.", "recognition": {"form": "label_list", "label": "constraints"}, "source_path": "handoffs/chassis-auth-handoff.md", "format": "markdown", "structured_locator": {"kind": "line_span", "line_start": 6, "line_end": 6}, "unit_index": 0, "block_kind": "list_item", "selection": {"roles": ["development_handoff"], "selected": true, "reasons": ["development_handoff selects constraint: work.blocked_by=security review (assertion:…), work.depends_on=chassis-core (assertion:…), …"]}, "epistemic_class": "source-declared", "authority_verified": false}
```

Each record also carries `evidence_id`, `artifact_id`, `rmp_artifact_id`, `raw_content_hash`,
`normalized_document_id`, `decoder_id`, `decoder_version`, `block_id`, `bounded_excerpt`,
`work_context`, `extractor_id`, `extractor_version` and `profile_version`; the full shape is
in `docs/architecture-evidence.md`.

## Known gaps and unsupported constructs

- A heading carrying a label inside a longer phrase (`Open Questions (v2)`); a bare `Questions` heading.
- Markdown frontmatter keys are read as labelled lines (the text decoder has no frontmatter construct).
- Tables in any format are reported, never quoted; a paragraph under a section is one statement with collapsed whitespace.
- A statement split across a soft line break inside one Word paragraph is quoted as its unit.
- A sentence whose colon prefix matches the label shape (`Hop limits are enforced: by Gate`) is skipped as a foreign label under a section, with a diagnostic.
- Records are ordered by `artifact_id` and `block_id` (hashes), so reading order within a document is not preserved; `structured_locator` is the coordinate.

## Authority decision required

ADR-087 is Proposed: whether `l9.architecture-evidence/v1` is a producer-owned, versioned
projection (as shipped: opt-in, no packet, Topology or Foundation change) or whether the
five statement classes should first be admitted to the Semantic Foundation and carried into
the Repository Model Packet (a separate, identity-moving change). The
`docs/architecture-authority.json` contracts map was deliberately not extended: its schema
is closed, and extending it is an authority change for the owner.
