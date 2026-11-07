# Brief — Adaptive Metadata Selection for Local-Source (receipt)

Status snapshot for the policy `local-source-metadata-selection/v1` (ADR-089, Proposed).
Stacked on PR #142 (role selection closure), which stacks on #141, #140 and #139. Owner
surfaces: `src/corpus_metadata_selection.ts` (new); `src/corpus_scan.ts`,
`src/corpus_roots.ts`, `src/corpus_snapshot.ts`, `src/corpus_index.ts` and
`scripts/local-source-cli.js` (wiring only).

## Revision binding

| Item | Value |
|---|---|
| Base | head of PR #142 (`claude-mobile/dazzling-feynman-azm517-roles`) |
| Branch | `claude-mobile/dazzling-feynman-azm517-metadata` |
| Head | the commit this brief ships in, plus the regenerated validation report |
| Policy identity | `local-source-metadata-selection/v1` 1.0.0; `metadata_selection_profile` = hash(policy hash, intent) enters `corpus_analysis_id` only when selected; source snapshot, root packets, evidence payload and every `evidence_id` unchanged with or without it and across intents (tested: five distinct analysis ids over one source) |
| Carrier | `external-generation`, `mutates_observed_files: false`; the CLI test proves the roots' listings and mtimes unchanged |

## What the policy chooses, and from what

| Input | Source |
|---|---|
| run intent | `--metadata-selection` (closed vocabulary of four; refused otherwise, and refused without `--architecture-evidence`) |
| document roles | `selection.roles` / `selection.role_evidence` of the evidence record — the document's own declarations through `architecture-development/v2` |
| statement classes | `statement_class` of the evidence record |
| marginal utility / redundancy | three rules: not in the intent's row; empty; redundant (`bounded_excerpt` = `declared_text`; `work_context.applicability` with no predicate beyond `work.status`) |
| bound | `max_per_document`, taken in the row's class order; dropped records listed as `bounded_out` |

Sixteen catalog fields, all existing evidence paths; six always carried. No score, no
weight, no inference, no new field, no deletion: every evidence record has one view
record with a reason, and `architecture-evidence.jsonl` stays complete beside it.

## Demonstration (one corpus, four intents, real generations)

| Document (declares) | `wip_design` | `accepted_declaration` | `development_handoff` | `historical_review` |
|---|---|---|---|---|
| proposal (`type: proposal`, `status: wip`) | all 8 statements; statuses, roles, excerpt where it adds the label | outside role | constraints, decisions, questions (6); intent and assumption `class_outside_intent` | outside role |
| spec `.docx` (`Type: specification`, `Status: active`) | outside role | constraint, decision (`open_question` outside class); `raw_content_hash`, statuses, role evidence, `authority_verified: false` | outside role | outside role |
| handoff (tasks, blocker, dependency, `Status: blocked`) | outside role | outside role | 2 constraints + 1 question; `work_context.handoff` counts carried; applicability `redundant` | outside role |
| archived design (`Status: archived`, `Superseded by:`) | outside role | outside role | outside role | decision, constraint, assumption (`open_question` outside class); applicability carries `work.superseded_by`; `raw_content_hash` |
| research note (`type: research`) | intent, assumption, question | outside role | outside role | outside role |
| untyped note | retained (`role_unknown_retained`) | not retained | retained, then `class_outside_intent` | not retained |

Included-id sets and carried-field sets are pairwise distinct across the four intents
(tested). The bound is demonstrated on a `Status: superseded` document with five
decisions and three constraints under `historical_review` (6): five decisions and one
constraint carried, two constraints `bounded_out`, counted in `by_reason`.

## Validation

- `tests/metadata_selection.test.ts` (15 tests): four intents, pairwise distinctness,
  bound, field accounting against the catalog and against the evidence values, manifest
  policy/carrier/derivation, default null + refusal without evidence, identity boundary,
  determinism, verifier refusals, CLI refusals/outputs/index/untouched roots.
- Existing suites unchanged in outcome; `npm run lint` and `npm run validate` green;
  validation report re-bound.

## Remaining gaps

- The intent vocabulary is four rows. A run for a purpose outside them is refused rather
  than approximated; adding one is a row and a policy version.
- The view is over architecture-evidence records only. Work-signal and packet records
  carry no role verdict of their own and are not viewed; a consumer reaches them through
  the query (`--role`).
- No consumer of the view ships here: no context assembler, no sidecar writer, no
  registry. The view is a published, verifiable file and nothing reads it yet.
