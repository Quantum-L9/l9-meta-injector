# Brief — Document-Role Selection Closure (receipt)

Status snapshot for selection profile `architecture-development/v2` (policy 2.0.0,
ADR-090, Proposed) and the opt-in `corpus-query --role` / `--selected-only` filters.
Authority for semantics: [`docs/architecture-evidence.md`](../architecture-evidence.md)
§ The selection profile and [`docs/corpus-evidence-query.md`](../corpus-evidence-query.md).

## Revision binding

| Item | Value |
|---|---|
| Base | `35624b2` — head of the architecture-statement coverage PR (`claude-mobile/wizardly-edison-p5du91-statements`), itself on `075c4ef` (#140, not yet on `main`) |
| Branch | `claude-mobile/wizardly-edison-p5du91-roles` |
| Implementation commit | `1f62eb2` (+ `b620b3b` manifest regenerated after the dist rebuild) |
| Validation report | green at `b620b3b`, bound at `d056650`; re-bound once more to the commit carrying this brief |
| Merge state | unmerged; no release, no admission |

## Owners touched (nothing new created)

| Concern | Owner | Change |
|---|---|---|
| role recognition and selection | `src/corpus_architecture_evidence.ts` (`selectForDocument`) | roles `decision_record`, `research`, `historical_record`; `readDocumentDeclarations` over the blocks it already holds; `status_families` / `status_conflict`; policy object + own hash; verifier checks |
| query interface | `src/corpus_query.ts`, `scripts/corpus-query-cli.js` | `role`, `selectedOnly` input; `--role NAME`, `--selected-only` (boolean in the ADR-069 grammar); echoed only when given |
| heading grammar reuse | `src/extractors/architecture_statements.ts` | exports `architectureHeadingLabel` (the 1.1.0 heading normalization), no behaviour change |
| comment | `src/corpus_scan.ts` | profile name in a doc comment |

## Policy identities

| Identity | Before (this stack's PR 1) | After |
|---|---|---|
| selection profile id | `architecture-development/v1` | `architecture-development/v2` |
| selection policy version | — | `2.0.0` |
| selection policy hash | — | `sha256:951d84c9cd916ffc9c57bf03b6b89d34056ae671e5c6b0af3857c1a496765069` |
| projection profile version | 1.1.0 | 1.2.0 |
| profile hash (bound into `corpus_analysis_id`) | `sha256:f85cc77f…9b80` | `sha256:26e2400a5d31c1854d25bec592ef8b51f89126ce2217f2cb03d094c5f102d8d3` |
| `corpus_analysis_id` (docs corpus) | `corpus-analysis:2c682bc7…5a01` | `corpus-analysis:6ad37a7e7aed39127ae45bd75b34812e244e19ebaea667da0a7709bf9a66a9de` |
| `corpus_source_snapshot_id` (docs corpus) | `corpus-source-snapshot:587bcf3d…1838` | identical |
| `evidence_id`s | 528 | the same 528 |

## Behaviour comparison on an actual generated corpus

`docs/` at `075c4ef` (148 decoded documents, 80 with statements), real CLI, PR 1 build vs
this build:

| | PR 1 (`v1`) | this PR (`v2`) |
|---|---|---|
| documents with role `unknown` | 77 | 2 (`contracts.md`, `legacy/consolidation-v1/traceability_map.yaml`) |
| `decision_record` | — | 75 (74 by `ADR-NNN` title; status: 69 accepted, 5 proposed, 1 superseded) |
| `historical_record` | — | 1 (ADR-029, `Superseded by …`) |
| `wip_proposal` | 3 | 8 (3 by `work.kind` plan, 5 by declared `proposed`) |
| records / selected | 528 / 528 | 528 / 528 (this corpus holds only classes its roles select) |
| `evidence_id`, text, coordinate, class | — | byte-identical for all 528 |

`- Status: Accepted` and `- **Status:** Accepted` (ADR-019, -021, -036 …) are read through
the labelled form; `## Status` → `Accepted.` through the section form.

Default query responses, PR 1 query build vs this build, on the same v2 generation
(`--limit 500`): no filter, `--class decision_statement`, `--class open_question --text
Gate`, `--source document_work_signals` — all four byte-identical (sha256 prefixes
`097191a8…`, `4abd99a2…`, `e7d83d14…`, `413fce02…`).

`--role` on that generation: `decision_record` 500 matches, `wip_proposal` 60,
`historical_record` 2, `unknown` 9; `--selected-only` 528. A historical result carries, for
example:

```json
"selection": {"profile_id": "architecture-development/v2", "policy_version": "2.0.0",
  "roles": ["decision_record", "historical_record"], "status_families": ["retired"],
  "status_conflict": false, "selected": true,
  "reasons": ["decision_record selects decision_statement: document.declared_status=superseded (architecture_declaration:2455b419…), document.decision_record_title=adr (architecture_declaration:23dc7b2d…)",
              "historical_record selects decision_statement: document.declared_status=superseded (architecture_declaration:2455b419…)"],
  "role_evidence": [{"predicate": "document.declared_status", "object": "superseded", "source": "document_declaration",
                     "block_id": "block:fb976901…", "structured_locator": {"kind": "line_span", "line_start": 5, "line_end": 5}, "…": "…"}]}
```

## Tests

`tests/architecture_document_roles.test.ts` (14), real `local-source` and `corpus-query`
CLIs over a corpus of every role: accepted, superseded and proposed records (section form,
emphasis + qualifier), research by declared kind, archived work, a self-contradicting
plan (`status: wip` + `Accepted.`), prose that only mentions "accepted", `Status: Accepted`
read once and `Status: superseded` never twice; every selected record has reasons and role
evidence or `unknown`; policy hash in the manifest and the analysis identity, source
snapshot unchanged; `--role`, `--selected-only`, byte-stable default echo, refusal of an
unknown role and of a generation without the projection.

| Command | Result |
|---|---|
| `npm run lint` | pass |
| `npm run validate` | pass, recorded in `CURRENT_VALIDATION_REPORT.md` |
| `git status --porcelain --untracked-files=all` | empty after each commit |

## Remaining gaps (stated, not claimed)

A status written only in prose, a status in a table, or a first word outside the closed
vocabulary establishes no role (the document stays `unknown` unless another declaration
applies). No supersession is resolved across documents: a superseded record is historical
because it says so, not because its successor was found. Role is not inferred from paths or
filenames. An "accepted" record is a declaration, never verified authority.

## Publication

Not published from this session, for the reason recorded in the PR 1 receipt (governance
`ci-parity` Biome lane vs this ESLint-owned repository; the bypass was refused as a CI
bypass). Awaits the operator's decision.
