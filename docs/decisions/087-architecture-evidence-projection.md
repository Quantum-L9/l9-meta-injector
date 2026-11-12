# ADR-087: Source-declared architectural statements as an opt-in evidence projection

## Status

Proposed. This is a candidate decision for owner review. The code it describes ships
behind an opt-in switch and changes no existing contract; the decision the owner is
asked to make is whether `l9.architecture-evidence/v1` is a projection this package
owns and keeps versioned, or whether the statement classes belong in the Semantic
Foundation first. Until accepted, the projection is a producer-local output with no
consumer binding and no admission of any kind.

## Date

2026-11-07

## Context

A corpus of design documents — proposals, specifications, decision notes, handoffs —
already states what it intends, what it assumes, what it is bound by, what it has not
resolved and what it has decided. The work-signal vocabulary (ADR-037, ADR-043) reads
the document's *state* out of every supported format: status, kind, tasks, milestones,
blockers, dependencies. It does not read the document's *architectural content*, so a
developer holding a hundred plans cannot ask the corpus which of them records an
unresolved question about routing, or what constraints a given specification actually
states, without opening them.

Three facts shape where that reading belongs:

- The normalized blocks every decoder already produces carry the coordinate each
  format really has (ADR-043), and the scan holds them in hand after the cache has
  served them. A reader over those blocks opens no file and touches no cache layer.
- The interpretation profile hash enters every Repository Model Packet's identity and
  keys the interpretation cache (ADR-032, ADR-082 §6). A new line-based extractor added
  to `defaultExtractors()` would move every packet id and invalidate every cached
  interpretation for an output nobody asked for.
- The corpus carries two identities (ADR-041): the source snapshot says what the disks
  held and the analysis id says what was concluded and under which rules. A projection
  that is selected per run belongs in the second and must not touch the first.

## Options Considered

### Option A: a new line-based extractor in the interpretation profile

- Pros: one extractor contract; statements reach the Repository Model Packet.
- Cons: moves `INTERPRETATION_PROFILE_VERSION`, every packet identity and every cached
  interpretation on a run that never asked for the output; reads Markdown only, since
  `InterpretedAssertion` cites line spans and a Word document has none (ADR-043); pushes
  five new predicates into a consumer contract this package does not own.

### Option B: a second reader over the normalized blocks, as an opt-in projection

- Pros: one implementation reads every decoded format at the coordinate it has; the
  pass runs after the cache and invalidates nothing; its rules enter the analysis
  identity only when selected; the output is a complete, hashed, versioned payload
  beside `document-work-signals.jsonl`, reusing that contract's completeness receipt;
  default runs are unchanged in every identity and payload.
- Cons: statements do not reach the Repository Model Packet or the Topology consumer.
  That is deliberate for this slice and is stated as a non-goal.

### Option C: an inferential classifier over document prose

- Pros: finds statements no author labelled.
- Cons: a sentence that sounds like a constraint is not evidence that the document
  declared one; every record would carry a guess with no coordinate a reader could
  check. Rejected by the same boundary ADR-037 draws for work signals.

## Decision

We choose **Option B**.

1. `src/extractors/architecture_statements.ts` (`architecture-statements/v1`, 1.0.0)
   recognizes five statement classes — `intent`, `constraint`, `assumption`,
   `open_question`, `decision_statement` — from three explicit forms only: a labelled
   field (`Objective:`, `Constraint:`, `Decision:` …), a labelled list (`Constraints:`
   then list items) and a labelled section heading (`## Open Questions` then items and
   paragraphs). The vocabulary is a closed table. Nothing is inferred from prose,
   filenames, timestamps, similarity or a model.
2. It reads the normalized blocks the scan already holds, for every decoded document
   including the text family, using the `Label: value` grammar the work-intelligence
   reader exports (`readLabelledLine`) so the two vocabularies cannot disagree about
   what a labelled line is. Units the work vocabulary claims, `Label: value` lines under
   an unknown label, table-shaped blocks and code are never quoted as statements; each
   case outside the grammar is a coverage diagnostic in the manifest.
3. A `line_span` block cites the exact line a statement sits on (the text decoder's
   block lines map one to one onto source lines); every other locator kind is cited
   verbatim with the unit offset beside it. No format is given a line number it does
   not have.
4. `src/corpus_architecture_evidence.ts` emits `architecture-evidence.jsonl`
   (`l9.architecture-evidence/v1`) and `architecture-evidence.manifest.json`
   (`l9.architecture-evidence-manifest/v1`): complete, never sampled, code-point
   ordered, with byte and semantic hashes, per-class, per-format, per-role and
   per-form counts, and the complete diagnostic list. Each record carries the corpus
   artifact id, the root's packet artifact id, the source content hash, the normalized
   document id, the decoder, the block, the structured locator, the statement class,
   the declared text, a bounded excerpt, the recognition form and label, the document's
   existing `work.kind` / `work.status` / applicability / handoff references by
   assertion id, the selection verdict, `epistemic_class: "source-declared"` and
   `authority_verified: false`. The scan refuses to publish a payload that fails its
   own receipt, exactly as it does for work signals.
5. One selection profile, `architecture-development/v1`, is a static table from a
   document's declared role to the classes a reader of that role is looking for:
   `wip_proposal` (kind in the proposal family, or status `wip`/`draft`/`planned`)
   selects all five; `specification` (kind `specification` or `decision`) selects
   `constraint` and `decision_statement`; `development_handoff` (kind `checklist`, or
   task/blocker/dependency declarations present) selects `constraint` and
   `open_question`; a document matching no rule is `unknown` and selects all five.
   Roles overlap and the selection is their union. Every record is emitted whether or
   not selected; `selection.reasons` names the rule and the assertion that decided it,
   and is empty for an unselected record. There are no weights, no classifier and no
   rule language.
6. The projection is selected by `architectureEvidence: true` on `runCorpusScan` and
   `--architecture-evidence` on the CLI. When selected, its profile hash is bound into
   `corpus_analysis_id` as `architecture_evidence_profile` and the snapshot names the
   payload under `architecture_evidence`; when not selected, neither field exists and
   `corpus_analysis_id` is the value it was before this ADR. The source snapshot id,
   every packet id, the interpretation profile, the work-signal payload and every cache
   layer are unchanged either way. The corpus-mode index lists the two files with
   `present: false` on a default run (ADR-068).
7. Not decided here, and explicitly out of scope: carrying statements into the
   Repository Model Packet or the Topology contract; admitting the statement classes to
   the Semantic Foundation; any authority resolution, supersession reconciliation,
   embedding, model extraction, source-file mutation or development-context assembly.

## Consequences

- A developer can ask the corpus which documents explicitly record unresolved
  questions, what constraints a design document stated, and which decisions a WIP
  artifact recorded, and receive records that cite the passage each answer rests on.
- `l9.architecture-evidence/v1` is a new, additive, versioned producer contract with no
  consumer binding. A change to the vocabulary, the grammar, the selection table or the
  record shape moves `ARCHITECTURE_EVIDENCE_PROFILE_VERSION` and, through the profile
  hash, the analysis identity of every run that selects it.
- No interpretation, block-signal, decoder or corpus profile version moves.
  `l9.repository-model` stays 1.1.0; `l9.document-work-signals/v1` is unchanged.
- Known gaps, recorded rather than closed: headings carrying a vocabulary word inside a
  longer phrase (`Open Questions (v2)`), a bare `Questions` heading, Markdown
  frontmatter keys (read as labelled lines because the text decoder has no frontmatter
  construct), tables in any format, and statements split across a soft line break in a
  Word paragraph are not recognized as statements. The first four produce diagnostics
  where they sit under a labelled declaration; the last is quoted as the unit it was
  found on.
- If the owner prefers Option A's packet reach, the reader is already position-free and
  can be attached to the interpretation seam; that would be a separate, identity-moving
  change under its own ADR.
