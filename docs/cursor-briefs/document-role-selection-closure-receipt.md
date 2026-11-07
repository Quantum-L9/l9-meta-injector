# Brief — Document-Role Selection Closure (receipt)

Status snapshot for the selection policy `architecture-development/v2` (evidence profile
1.2.0) and the role filters of the corpus evidence query. Stacked on PR #141 (coverage
closure), which stacks on #140 (query) and #139 (projection). Owner surfaces:
`src/corpus_architecture_evidence.ts` (selection) and `src/corpus_query.ts` plus
`scripts/corpus-query-cli.js` (query).

## Revision binding

| Item | Value |
|---|---|
| Base | head of PR #141 (`claude-mobile/dazzling-feynman-azm517-coverage`) |
| Branch | `claude-mobile/dazzling-feynman-azm517-roles` |
| Head | the commit this brief ships in, plus the regenerated validation report |
| Policy identity | `architecture-development/v1` → `v2`; evidence profile 1.1.0 → 1.2.0; profile hash (and so `corpus_analysis_id` for runs that select the projection) moves; source snapshot, root packet ids and evidence ids do not |

## Roles (each from explicit declarations only)

| Role | Established by | Selects |
|---|---|---|
| `wip_proposal` | `work.kind` design, plan, proposal, roadmap; or `work.status` draft, planned, wip | all five |
| `specification` | `work.kind` decision, specification | constraint, decision_statement |
| `accepted_declaration` (new) | `work.status` active, complete, done | constraint, decision_statement, intent |
| `development_handoff` | `work.kind` checklist; or any task, blocker or dependency declaration | constraint, open_question |
| `research` (new) | `work.kind` notes, research | assumption, intent, open_question |
| `historical` (new) | `work.status` archived, cancelled, superseded; or any `work.superseded_by` | constraint, decision_statement |
| `unknown` | none | all five |

Roles overlap and the view is their union; every record is emitted with
`selection.selected`, `selection.reasons` (rule + `predicate=object (assertion_id)`) and
`selection.role_evidence`; the manifest carries the whole table under
`selection_policy`. An accepted or historical role is a reading of what the document
declared, never a verdict that the declaration holds today.

## Query

`--role NAME` files every record's document, from any source, under the roles the same
selector derives from the generation's work signals and packet assertions, and returns
`roles_by_document` (roles plus the assertion ids behind them). `--selected-only` keeps
only selected architecture-evidence records; it is `unsupported` against a generation
made without the projection. An unfiltered response is byte-identical to before: the
new `query` fields and `roles_by_document` appear only when used (tested by key set).

## Evidence from the fixture corpus (real generation)

| Document | Declarations | Roles | Selected | Unselected (retained) |
|---|---|---|---|---|
| `specs/transport-packet-spec.docx` | title kind specification; `Status: active` | specification, accepted_declaration | constraint, decision_statement | open_question |
| `history/old-routing.md` | `Status: archived`; `Superseded by: …` | historical | decision_statement, constraint | open_question |
| `research/latency-study.md` | frontmatter `type: research` | research | intent, assumption, open_question | decision_statement |
| `specs/accepted-chassis.md` | `Status: done` | accepted_declaration | decision_statement, constraint | open_question |
| `plans/gate-routing-proposal.md` | `type: proposal`, `status: wip`, `Status: blocked` | wip_proposal | all | — |
| `handoffs/chassis-auth-handoff.md` | tasks, blocker, dependency, reference | development_handoff | constraint, open_question | — |
| `notes/untyped.md` | none | unknown | all | — |

`corpus-query --role historical` returns the archived decision (architecture evidence)
and the `Status: archived` line itself (packet assertion) with
`roles_by_document: [{roles: ["historical"], role_evidence: [work.status=archived, work.superseded_by=…]}]`.
`--role development_handoff --predicate work.task.open` finds the handoff's open task by
role rather than by path.

## Validation

- `tests/architecture_evidence.test.ts` (+1 test: historical, research, accepted roles and the manifest policy), `tests/corpus_query.test.ts` (+4: role filter with evidence across sources, selected-only, refusals, unfiltered shape), `tests/architecture_statement_coverage.test.ts` (version pin).
- `npm run lint` and `npm run validate` green; validation report re-bound.

## Remaining gaps

- A role is established only by the closed declaration sets above. A document that says `Status: final` or `Type: rfc` is `unknown`; the vocabularies are the work extractor's and are not widened here.
- `--selected-only` applies to architecture-evidence records only, because only they carry a selection verdict; work-signal and packet records are filtered by role, never by selection.
