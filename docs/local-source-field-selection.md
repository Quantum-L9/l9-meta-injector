# Local-source field selection

An opt-in, deterministic view over one local-source generation: for each document, which
of its **existing** evidence fields a declared run intent surfaces, and why — for every
field it surfaced and every field it did not. Authority:
[ADR-091](decisions/091-local-source-adaptive-field-selection.md) (Proposed). It reads the
roles of [ADR-090](decisions/090-document-role-selection-closure.md), the statements of
[ADR-087](decisions/087-architecture-evidence-projection.md) / ADR-089 and the work
assertions the run already produced.

## Selecting it

```bash
npm run local-source -- --root <dir>=<Name> --out <out> --architecture-evidence \
  --field-selection <intent> [--field-selection-max-fields N] \
  [--field-selection-max-values N] [--field-selection-max-chars N]
```

`--field-selection` needs `--architecture-evidence` (it reads the roles that projection
assigns) and is refused without it; a budget flag without `--field-selection` is refused.
Programmatically: `runCorpusScan({ …, architectureEvidence: true, fieldSelection: { intent,
budget } })` → `result.fieldSelection` (null when not asked for).

A run that does not pass the flag is unchanged: no file, no `corpus-index.json` entry, no
summary line, no identity moves. With it, the generation gains

```text
field-selection.jsonl            l9.local-source-field-selection/v1           one record per evidence-bearing document
field-selection.manifest.json    l9.local-source-field-selection-manifest/v1  policy, intent, budget, carrier, counts, hashes
```

listed in `corpus-index.json` as present, and `corpus-snapshot.json` carries
`analysis.field_selection_profile` (bound into `corpus_analysis_id`) and `field_selection`
(record count and two hashes).

## What it chooses among

Only fields the generation already holds, each cited by the id its own payload gave it:

| Field | Source |
|---|---|
| `statement.intent`, `.constraint`, `.assumption`, `.open_question`, `.decision_statement` | `architecture-evidence.jsonl` records (`evidence_id`) |
| `declaration.declared_status`, `declaration.decision_record_title` | the selection's block-read declarations (`declaration_id`) |
| `work.status`, `work.kind`, `work.task.open`, `work.task.completed`, `work.blocked_by`, `work.depends_on`, `work.milestone`, `work.references`, `work.supersedes`, `work.superseded_by`, `document.title`, `document.heading` | the root packet's interpreted assertions (`assertion_id`) or `document-work-signals.jsonl` (`signal_id`) |

## How it decides (policy `local-source-field-selection/v1` 1.0.0)

1. **Intent** — a closed set: `architecture_review`, `design_exploration`,
   `development_handoff`, `history_audit`. Each names *core* and *supporting* fields.
2. **Role** — every source-declared role the document holds promotes fields to core,
   whatever the intent: `decision_record` → decisions, declared status;
   `development_handoff` → open tasks, blockers, dependencies; `historical_record` →
   successor, declared status, `work.status`; `research` → assumptions, open questions;
   `specification` → constraints; `wip_proposal` → open questions, assumptions,
   `work.status`. `unknown` promotes nothing.
3. **Availability** — a planned field with no value is `unavailable` ("the document declares
   no …"); nothing is invented for it.
4. **Redundancy and marginal utility** — a field whose every value (trimmed, lowercased,
   whitespace-collapsed) is already in this document's view is `redundant`; a document that
   is a non-representative member of an exact-duplicate cluster has every available field
   `redundant` with the representative, cited by cluster id. Near-duplicate candidates are
   listed, never used to suppress (they are candidates, not facts).
5. **Budget** — per document, at most `maxFields` selected fields (default 6),
   `maxValuesPerField` values each (5) and `maxCharacters` characters of value (2000, each
   value bounded at 240). A field past the field bound is `omitted_by_budget`; values a
   selected field could not fit are counted in `values_omitted`.
6. Every other field the document has a value for is `not_selected_for_intent`.

Order is fixed: core (intent order, then role promotions in role order), supporting, the
rest by name. Every decision carries its reasons as sentences generated from the tables.
There are no weights, scores, models or rule language.

## Carrier disposition

Local-source always writes to its external generation under `--out`. The manifest and every
record say so (`carrier_disposition: "external_generation"`, `observed_files_mutated:
false`), and the in-repository carriers are recorded as refused: `central_manifest` (it
would write under the observed root) and `inline_managed` (it would rewrite the observed
file), both by ADR-036. The view is published through the same atomic generation as the
evidence it cites.

## Identity

`field_selection_profile` = hash of the policy, the intent and the budget. Bound into
`corpus_analysis_id` only when the view is asked for, so two intents or two budgets never
share an analysis identity. The source snapshot, every packet, every evidence, declaration,
signal and assertion id, and every other payload are byte-identical with or without it.

## Verified before publication

`verifyFieldSelectionExport`: counts and both hashes; per-field tallies; every cited id is
carried by a payload of the same generation; every record is `source-declared`,
`authority_verified: false`, within budget, carrier external; every decision has a reason
and `selected` exactly when it carries values. A view that fails is not published.

## What it is not

Not an index, a registry, a ranking, a context assembler, an authority resolver or a sidecar
writer. It copies no text it cannot cite, joins no documents, and changes no source record. A
selected `decision_statement` from a record that declared itself `Accepted` is still a
source declaration.
