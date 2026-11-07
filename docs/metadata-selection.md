# Metadata selection

Which of the evidence a local-source run already has is the most useful to carry for
the purpose the run was made for — chosen per record from existing fields by one static
policy, with the reason for every field, and never at the cost of the evidence itself.

Authority: [ADR-089](decisions/089-intent-bound-metadata-selection-view.md) (Proposed).
Derives from the architecture-evidence payload of [ADR-087](decisions/087-architecture-evidence-projection.md)
and the role policy `architecture-development/v2`; publishes through the generation mechanism of
[ADR-042](decisions/042-binary-document-decoding-generational-publication-and-bounded-candidate-work.md)
and [ADR-066](decisions/066-generation-retention-order-and-exclusive-publisher-lock.md);
enters the analysis half of the identity split of [ADR-041](decisions/041-corpus-source-identity-verification-class-and-partial-corpora.md).

## Selecting it

```bash
npm run local-source -- --root /Volumes/Designs=Designs --out <dir> \
  --architecture-evidence --metadata-selection development_handoff
```

Off by default. `--metadata-selection` takes one run intent from a closed vocabulary —
`wip_design`, `accepted_declaration`, `development_handoff`, `historical_review` — and is
refused with any other word, and refused without `--architecture-evidence`: the view is
derived from that payload and from nothing else. A run that does not pass it is the run
it always was, identities included; the corpus index lists the two files below as
`present: false` and the CLI prints no `metadata view` line.

With the flag, the generation gains:

| File | Schema | What it is |
|---|---|---|
| `metadata-selection.jsonl` | `l9.metadata-selection/v1` | one record per architecture-evidence record, in the evidence payload's order, saying whether the intent carries it, why, and — when it does — which of its fields |
| `metadata-selection.manifest.json` | `l9.metadata-selection-manifest/v1` | the policy table in full, the intent, the evidence it derives from (by hash), the carrier disposition, counts by reason, class and field, and the payload's two hashes |

The snapshot carries `metadata_selection` (a reference like `architecture_evidence`) and
`analysis.metadata_selection_profile`. The CLI prints one line:

```text
metadata view    development_handoff: 9 of 23 evidence record(s) carried from 2 of 6 document(s); carrier external-generation, no observed file written
```

## The policy

`local-source-metadata-selection/v1` is one static table. A record is in the view when
its document's roles (from the selection policy, by the document's own declarations)
meet the intent's roles — or the document declares no role and the intent retains such
documents for recall — and its statement class is one the intent wants. A document
contributes at most `max_per_document` records, taken in the intent's class order, and a
record the bound drops is listed as `bounded_out`, not dropped.

| Intent | Roles | Declared statuses | Unknown role | Classes, most useful first | Fields beyond the always-set | Bound |
|---|---|---|---|---|---|---|
| `wip_design` | `wip_proposal`, `research_notes` | — | retained | open_question, assumption, intent, decision_statement, constraint | `bounded_excerpt`, `work_context.statuses`, `work_context.handoff`, `selection.roles` | 8 |
| `accepted_declaration` | `specification` | `active`, `complete`, `done` | not retained | constraint, decision_statement, intent | `raw_content_hash`, `work_context.statuses`, `selection.roles`, `selection.role_evidence`, `authority_verified` | 12 |
| `development_handoff` | `development_handoff`, `wip_proposal` | — | retained | open_question, constraint, decision_statement | `bounded_excerpt`, `work_context.handoff`, `work_context.applicability`, `selection.roles`, `selection.role_evidence` | 8 |
| `historical_review` | — | `archived`, `cancelled`, `superseded` | not retained | decision_statement, constraint, assumption | `raw_content_hash`, `work_context.applicability`, `work_context.statuses`, `selection.roles`, `selection.role_evidence` | 6 |

A document is in the view when its roles meet the intent's roles
(`role_matches_intent`) or it declared one of the intent's statuses
(`status_matches_intent`): a declared lifecycle status is a separate axis from a role
(`architecture-development/v2` has no accepted or historical role), so an intent about
accepted or superseded documents reads the `work.status` the document declared, and the
explanation says it is a source declaration, not a verified lifecycle.

The always-set, carried on every included record: `evidence_id`, `artifact_id`,
`source_path`, `statement_class`, `declared_text`, `structured_locator`. Accepted and
historical are *declared* accepted and *declared* superseded — a reading of the
document's own `work.status`, not a verdict that it holds
today — which is why those two intents retain no undeclared document and why the
accepted view carries `authority_verified` (always `false`) so a consumer reading the
view alone still sees it.

## Field reasons

Every included record accounts for every field in the catalog, in catalog order:

| Disposition | Meaning |
|---|---|
| `always` | in the always-set |
| `intent_selects` | the intent's row names it and the record carries a value |
| `not_in_intent` | the intent's row does not name it |
| `empty` | named, but the record carries nothing under it (no tasks, no statuses) |
| `redundant` | named, but it says nothing another carried field does not: `bounded_excerpt` equal to `declared_text`; `work_context.applicability` with no predicate beyond `work.status` |

Marginal utility is those two rules and the empty rule, nothing more: there is no score,
no weight and no model. A field's value in the view is the evidence record's own value.

## What the view is not

- **Not a filter on the evidence.** `architecture-evidence.jsonl` is written complete
  beside it; every evidence record has exactly one view record, included or not, with
  its reason (`role_matches_intent`, `status_matches_intent`, `role_unknown_retained`,
  `role_outside_intent`, `class_outside_intent`, `bounded_out`).
- **Not a new field.** The catalog names sixteen paths of the evidence record and the
  verifier refuses any other.
- **Not authority.** `epistemic_class` and `authority_verified: false` are carried from
  the evidence; contradictions between documents are untouched.
- **Not a writer.** `carrier.disposition` is `external-generation`: the view lives in the
  generation directory the scan publishes atomically, and no observed file is opened for
  writing, annotated or given a sidecar. The CLI test proves the roots' listings and
  modification times are unchanged.
- **Not a second identity.** `metadata_selection_profile` (policy hash + intent) enters
  `corpus_analysis_id` only when selected; `corpus_source_snapshot_id`, the root packets,
  the evidence payload and every `evidence_id` are the same with or without it, and the
  same across intents.

## Verification

`verifyMetadataSelectionExport` runs before the generation is published and refuses: a
count or hash the payload does not support; a view that derives from evidence other than
the payload beside it; a record whose `evidence_id` the evidence does not carry, or an
evidence record with no verdict; fields on an excluded record, a field outside the
catalog, an always-field missing, or a disposition that disagrees with the field's
presence; a manifest that does not state the external-generation carrier.
