# Brief — Evidence-Grounded Document-Role Selection Closure (receipt)

Status snapshot for the PR 2 closure of the Local-Source Capability Closure campaign:
selection policy `architecture-development/v2` at evidence profile 1.3.0, and the
query's role filters re-grounded in recorded evidence. Supersedes the earlier
`document-role-selection-closure-receipt.md` (PR #142) where the two disagree. Stacked on
PR #143 (metadata view), which stacks on #142, #141, #140 and #139.

## A. Revision coordinates

| Item | Value |
|---|---|
| Repository | `Quantum-L9/l9-meta-injector` |
| `main` at execution | `a6145334df2fc8943a6fec39810926ef0f9f6ea4` (merge of #139) |
| Base | head of PR #143, `95afe195670fc5bc73bc2e59dde2744ce2b069fa` (`claude-mobile/dazzling-feynman-azm517-metadata`) |
| Branch | `claude-mobile/dazzling-feynman-azm517-roles-v2` |
| Head | the commit this brief ships in, plus the regenerated validation report |
| Predecessors | #139 `6761ec2` merged to `main`; #140 `5ec1e45` merged into `claude-mobile/dazzling-feynman-azm517`; #141 `b45e66d` merged into `…-retrieval`; #142 `c5a61ab` open; #143 `95afe19` open |
| ADRs | ADR-041/042/043/066/069/082 Accepted, unchanged; ADR-087 Proposed, amended 2026-11-07 under its own number; ADR-088 Proposed, unchanged; ADR-089 Proposed, one row widened |

Scope removed as already implemented in #142: `--role`, `--selected-only`, the
`role?`/`selectedOnly?` query inputs, the strict value/boolean parsing, the versioned
policy id `architecture-development/v2`, the `selection_policy` manifest field.

## B. Actual code change

| File | Change |
|---|---|
| `src/corpus_architecture_evidence.ts` | roles closed at `wip_proposal`, `specification`, `development_handoff`, `research_notes`, `unknown`; `accepted_declaration` and `historical` withdrawn; `research_notes` selects all five classes; `selected_for_roles` typed per record from the same rule pass; `UNKNOWN_ROLE_EXPLANATION`; `verifyRoleSelection` invariants in the existing verifier; profile 1.2.0 → 1.3.0; policy statement |
| `src/corpus_query.ts` | role filters read recorded `selection` fields only; `selectForDocument` re-derivation, `roles_by_document` and the assertion collection removed; `architecture_evidence`-only evaluation with an `info` diagnostic; `unsupported` for another source, for `--predicate`, without the projection, and for `--role`+`--selected-only` on a generation without `selected_for_roles` |
| `scripts/corpus-query-cli.js` | help text; repeated flag, empty value and `--selected-only=true` refused |
| `src/corpus_metadata_selection.ts` | required binding only: intents that named the withdrawn roles read declared statuses (`statuses` row field, `status_matches_intent`) |
| `dist/` | rebuilt from the above |

Role rules before → after:

| Role | Before (#142) | After |
|---|---|---|
| `wip_proposal` | kinds design/plan/proposal/roadmap; statuses draft/planned/wip; all five | unchanged |
| `specification` | kinds decision/specification; constraint, decision_statement | unchanged |
| `development_handoff` | kind checklist or task/blocker/dependency predicates; constraint, open_question | unchanged |
| `research` | kinds notes/research; assumption, intent, open_question | **`research_notes`**, all five classes |
| `accepted_declaration` | statuses active/complete/done | **withdrawn** (status is not a role) |
| `historical` | statuses archived/cancelled/superseded or `work.superseded_by` | **withdrawn** (status is not a role) |
| `unknown` | "declares no work.kind, work.status or handoff evidence" | "no supported document-role rule matched the available source declarations; all observed architectural classes remain selected to preserve recall" |

## C. Semantic evidence (real generation over the synthetic corpus)

| Scenario | Document declares | roles | selected_for_roles per class | role evidence |
|---|---|---|---|---|
| A pure WIP proposal | `type: proposal`, `status: wip` | `wip_proposal` | all five → `[wip_proposal]` | `work.kind=proposal`, `work.status=wip` |
| B pure specification | `type: specification` | `specification` | constraint, decision_statement → `[specification]`; open_question → `[]` (retained, unselected) | `work.kind=specification` |
| C handoff | open task, `Blocked by:` | `development_handoff` | constraint, open_question → `[development_handoff]` | `work.task.open=…`, `work.blocked_by=…` |
| D research notes | `type: research` | `research_notes` | all five → `[research_notes]` | `work.kind=research` |
| E research + WIP | `type: research`, `status: wip` | `research_notes`, `wip_proposal` | each → both, no priority | both declarations |
| F archived specification | `type: specification`, `status: archived` | `specification` | constraint → `[specification]`; open_question → `[]`; `work_context.statuses` = archived; `--status archived` matches | `work.kind=specification` only |
| G contradictory statuses | `Status: wip`, `Status: complete` | `wip_proposal` | constraint → `[wip_proposal]`; both statuses retained | `work.status=wip` |
| H no positive match | `Status: archived` only | `unknown` | all → `[unknown]` | none; fallback reason |
| I overlap | `type: specification` + open task | `development_handoff`, `specification` | constraint → both; open_question → `[development_handoff]`; decision_statement → `[specification]` | kind and task assertions |

## D. Critical overlapping-role proof

`tests/architecture_evidence.test.ts` asserts the table for I from a real scan;
`tests/corpus_query.test.ts` asserts, over a real generation, that
`--role specification --selected-only` returns the overlap document's constraint and
decision only, `--role development_handoff --selected-only` its constraint and question
only, and `--selected-only` alone all three; the CLI's bytes equal the API's. The
receipt's `npm run corpus-query` transcript is recorded in the PR report.

## E. Identity comparison

Captured on the same synthetic corpus with the committed `dist/` before and after:

| Identity | Before (#143 head) | After | Change |
|---|---|---|---|
| `corpus_source_snapshot_id` | same | same | none |
| root packet id | same | same | none |
| evidence ids (29) | same set | same set | none: `selection` is outside the identity |
| selection profile | `architecture-development/v2` 1.2.0 | `architecture-development/v2` 1.3.0 | intended |
| `architecture_evidence_profile` hash | moved | moved | intended: table and record contract changed |
| `corpus_analysis_id` | moved | moved | intended, through the profile hash |
| payload hashes | moved | moved | intended: `selected_for_roles`, roles, reasons |
| unfiltered query bytes on the old generation | same | same | none: the new query over the old generation is byte-identical |

The exact values are in the PR report.

## F. Test evidence

- Focused: `tests/architecture_evidence.test.ts` (+2 tests: overlap/E/F/G, verifier
  adversarial cases), `tests/corpus_query.test.ts` (role block rewritten: recorded
  membership, overlap gate via API and CLI, composition with `--status`/`--kind`/`--class`/
  `--root`/`--text`, refusals, a legacy generation rebuilt with valid integrity proofs,
  strict grammar), `tests/metadata_selection.test.ts` (status binding),
  `tests/architecture_statement_coverage.test.ts` (version pin).
- Repository gates: `npm run lint`, `npm run validate` (typecheck, Vitest, API,
  authority, manifest, dist parity, packed consumer proof) green; validation report
  re-bound. Exit statuses are in the PR report.

## G. Residual gaps

- Markdown declares its kind in frontmatter (`type:`) or in a title word; a body
  `Type: specification` line is a Word-paragraph form and is not read as a kind in
  Markdown. Not a change of this PR; the fixtures use the supported forms.
- A document with a declared kind and no recognized architectural statement appears
  under no role: the projection is statement-level, and a document-role inventory is a
  separate capability.
- Pre-1.3.0 generations answer `--role` and `--selected-only` singly and refuse the
  combination.
- Owner decision pending: ADR-087's amendment and ADR-089 remain Proposed.

## H. Boundaries

No parallel index compiler; no new evidence store; no new extraction pipeline; no
original-file, header or sidecar modification (the CLI tests prove the roots' listings
and modification times unchanged); no external-repository change; no dynamic strategic
field optimization (PR 3's policy only re-bound its two rows); no automatic authority
promotion; no merge or publication.
