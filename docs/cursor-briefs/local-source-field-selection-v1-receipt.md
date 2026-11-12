# Brief — Adaptive Metadata Selection for Local-Source (receipt)

Status snapshot for `local-source-field-selection/v1` (policy 1.0.0, ADR-091, Proposed).
Authority for semantics: [`docs/local-source-field-selection.md`](../local-source-field-selection.md).

## Revision binding

| Item | Value |
|---|---|
| Base | `6d8e914` — head of the document-role selection PR (`claude-mobile/wizardly-edison-p5du91-roles`) |
| Branch | `claude-mobile/wizardly-edison-p5du91-adaptive` |
| Implementation commit | `6da4ad1` |
| Validation report | green at `6da4ad1`, bound at the next commit; re-bound once more to the commit carrying this brief |
| Merge state | unmerged; no release, no admission |

## Owners touched (no new compiler, registry, store, resolver, assembler, sidecar or scorer)

| Concern | Owner | Change |
|---|---|---|
| the policy (pure function) | `src/corpus_field_selection.ts` (new, the one policy module) | intent / role-promotion tables, availability, redundancy, budget, export, verify, ref |
| analysis | `runCorpusScan` (`src/corpus_scan.ts`) | builds the view after the duplicate analyses from records it already holds; refuses without architecture evidence; verifies before publication; result `fieldSelection` |
| identity | `src/corpus_roots.ts`, `src/corpus_snapshot.ts` | optional `field_selection_profile` in `corpus_analysis_id`; snapshot `field_selection` ref |
| projection / publication | `scripts/local-source-cli.js`, `src/corpus_index.ts` | `--field-selection`, three budget flags; two files pushed into the same atomic generation; index lists them only when written |

## Policy identities

| Identity | Value |
|---|---|
| policy | `local-source-field-selection/v1` 1.0.0 |
| policy hash | `sha256:7cf13a604e1fc472719e47c277ff7197c6c7ca62bb48204e823a4f101c86ce92` |
| profile hash, `architecture_review`, default budget (6 / 5 / 2000) | `sha256:f4691a55d9f9a734e0ee42474a4890e3716c82242d27859a773e8b01fb523e0d` |
| profile hashes on `docs/`, other intents | `development_handoff` `sha256:bac25807a457a492…`, `history_audit` `sha256:9c594bd0450cb43b…`, `design_exploration` `sha256:03ad4b8231d50f09…` |
| schemas | `l9.local-source-field-selection/v1`, `l9.local-source-field-selection-manifest/v1` |
| source snapshot / evidence ids | unchanged by the view (asserted in the tests and on `docs/`) |

## Demonstration — four source declarations, four intents (real CLI, actual generation)

`npm run local-source -- --root <corpus>=Designs --out <out> --architecture-evidence --field-selection <intent>`
over a WIP design, an accepted-status ADR, a development handoff and a superseded ADR. Fields
selected per document (in decision order); every other field carries its disposition and
reason in the record. Roles are what the documents declared, not verified authority.

| Document | roles | architecture_review | development_handoff | history_audit | design_exploration |
|---|---|---|---|---|---|
| WIP design (`type: design`, `status: wip`) | wip_proposal | decision_statement, constraint, open_question, assumption, w.status, intent | open_question, constraint, assumption, w.status, decision_statement | w.status, decision_statement, open_question, assumption, intent, document.title | intent, open_question, assumption, w.status, constraint, w.references |
| Accepted-status declaration (ADR-012, `## Status` → `Accepted.`) | decision_record | decision_statement, constraint, decl.declared_status, assumption, decl.decision_record_title | constraint, decision_statement, decl.declared_status | decl.declared_status, decision_statement, document.title | assumption, decision_statement, decl.declared_status, constraint |
| Development handoff (`type: checklist`, tasks, blocker, dependency) | development_handoff | constraint, w.task.open, w.blocked_by, w.depends_on, w.status | w.task.open, w.blocked_by, open_question, constraint, w.depends_on, w.status | w.status, w.task.open, w.blocked_by, w.depends_on, document.title | open_question, w.task.open, w.blocked_by, w.depends_on, constraint, w.status |
| Historical (ADR-003, `Superseded by ADR-012.`) | decision_record, historical_record | decision_statement, decl.declared_status, intent, decl.decision_record_title | decision_statement, decl.declared_status | decl.declared_status, decision_statement, intent, document.title | intent, decision_statement, decl.declared_status |

The same intent selects materially different fields per document because each document's
declared role promotes different fields (`declared role development_handoff promotes
work.task.open to core`, `declared role historical_record promotes
declaration.declared_status to core`). The superseded ADR's successor was declared only in
prose under `## Status`, so `work.superseded_by` is `unavailable` rather than invented.
In the test corpus a byte-identical copy of ADR-012 is `redundant` field by field with its
cluster representative and contributes nothing.

## Behaviour on an actual generated corpus

This repository's `docs/` at `075c4ef` (132 evidence-bearing documents):

| intent | records | fields selected | max characters / document |
|---|---|---|---|
| architecture_review | 132 | 233 | 1,211 |
| development_handoff | 132 | 159 | 1,208 |
| history_audit | 132 | 298 | 1,395 |
| design_exploration | 132 | 166 | 1,257 |

`corpus_source_snapshot_id` identical across all four (`587bcf3d…`); each intent its own
`corpus_analysis_id`.

**Default behaviour unchanged.** The `roles`-branch build (`6d8e914`) and this build, same
corpus, same `--generated-at`: a default run (33 files) and an `--architecture-evidence`-only
run (35 files) are identical in every output file and in stdout once two pre-existing
wall-clock fields are normalized (`roots/<root>/local-source-manifest.json` `observed_at`,
`corpus-intelligence/packet.json` `created_at` — and the packet's hash in
`corpus-intelligence/manifest.json`). Those two fields differ between any two runs of either
build; recorded as a separate finding (session debt `local-source-corpus-wallclock`), not
changed here.

## Tests

`tests/local_source_field_selection.test.ts` (12), real CLIs: four kinds of document → four
different views with the rule named; re-planning per intent; exact-duplicate redundancy;
every selected value resolved (architecture ids from the payload, packet assertion ids through
`corpus-query`); external-generation carrier with the observed tree hashed unchanged; payloads
byte-identical with and without the view; identity binding (snapshot same, analysis ids
distinct per intent and budget); determinism; default run writes no file, index entry or
summary line; budget bounds; refusals; cross-field value redundancy.

| Command | Result |
|---|---|
| `npm run lint` | pass |
| `npm run validate` | pass, recorded in `CURRENT_VALIDATION_REPORT.md` |
| `git status --porcelain --untracked-files=all` | empty after each commit |

## Remaining gaps (stated, not claimed)

Four intents only; fields only from existing evidence (no new extraction); redundancy is exact
value identity within a document and exact-duplicate clusters (near-duplicates reported, never
suppressing); no `corpus-query` surface for the view yet; the view is producer-local with no
consumer binding.

## Publication

Not published from this session, for the reason recorded in the earlier receipts (governance
`ci-parity` Biome lane vs this ESLint-owned repository; the bypass was refused as a CI
bypass). Awaits the operator's decision.
