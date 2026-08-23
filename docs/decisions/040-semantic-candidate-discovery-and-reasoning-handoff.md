# ADR-040: Semantic candidates are multi-signal evidence, and the reasoning queue is a routing decision

## Status

Accepted. Extends [ADR-037](037-corpus-intelligence-artifact-scope-and-duplicate-topology.md)
(artifact-scoped evidence, duplicates as facts and near-duplicates as candidates)
and [ADR-038](038-multi-root-corpus-incremental-cache-and-readiness-evidence.md)
(multi-root corpora, content-addressed reuse, readiness evidence). Neither is
superseded. [ADR-039](039-real-corpus-qualification-report.md) is untouched.

## Date

2026-08-23

## Context

The corpus layer can say two artifacts are byte-identical, and it can say their
wording overlaps. It cannot say anything about the case an archaeology tool
exists for: the same body of work scattered under three names across two disks,
where no two files are duplicates and the vocabulary drifted between 2019 and
2023.

Answering that needs evidence of more than one kind, weighed together, and it
needs the weighing to be legible. It also needs a boundary drawn early, because
the failure mode is not computing a wrong number — it is a number being promoted
into a claim. Similarity becomes "same topic", a shared folder becomes "same
project", a model's cosine becomes a fact, and a corpus report starts telling
people what to delete.

## Decision

### One pass, five stages, each owning one decision

`corpus_semantics` builds a per-artifact feature view and deterministic
keyphrases; `corpus_pairs` scores pairs on nine independently-computed signals;
`corpus_fusion` turns pairs into typed candidates; `corpus_reasoning` routes
candidates to a future reasoner and packs bounded evidence; `corpus_embeddings`
supplies optional model-derived recall. `corpus_semantic_run` orders them and
emits the documents. No stage decides what a later stage's evidence means.

### Corroboration is counted by family, never by signal

Title overlap, heading overlap and keyphrase overlap are three metrics over one
document's vocabulary. They agree because they must. Evidence is therefore
counted by family — lexical, declared identity, graph, semantic model, context —
and three lexical metrics count once. Without this rule, any two documents by one
author in one house style corroborate themselves into a strong candidate.

### The contract's classification had a gap, and it resolves upward

The contract defines `weak` as "one non-authoritative signal without independent
corroboration" and `moderate` as "at least two independent evidence families".
Neither names the case of several strong metrics inside *one* family — and the
contract's own `lexical_related` fixture expects exactly that case to produce a
topic candidate.

Resolved to `moderate`, and deliberately no further:

- `strong` still requires two independent families, so within-family
  corroboration alone can never produce a strong relationship;
- project admission is untouched and still demands declared identity, an explicit
  graph edge, or two genuinely independent families;
- embedding-only cannot reach it, because that family has exactly one metric and
  cannot corroborate itself.

### Three candidate types, three different claims

`TOPIC_CANDIDATE` says the members show evidence of discussing related subject
matter. `PROJECT_CANDIDATE` says there is evidence they may belong to one body of
work — admitted only on declared identity, an explicit reference or dependency,
or corroborated similarity. `CONSOLIDATION_CANDIDATE` says a person may want to
look at these together, and carries no field that could be read as an
instruction: no keeper, no canonical copy, no recommended action.

Exact duplication stays a fact and is carried through. It is explicitly *not*
evidence of a shared project: a copy proves a copy happened, and copies cross
projects routinely.

### Reasoning eligibility is a routing decision, and mostly a refusal

`reasoning-routing/v1` answers one question deterministically: is there anything
here a language model could settle that the evidence has not already settled? The
negative answers are where a budget is saved — exact duplicates are already
decided, a single weak signal has nothing to adjudicate between, and an
embedding-only candidate is a model's opinion already, so asking a second model
to rule on the first adds a step rather than evidence.

"Reasoning eligible" is not a compliment and does not mean important, correct, or
valuable. Every routed candidate carries a reason, including the ones routed to
`NONE`, so the refusals are checkable rather than invisible.

### Embeddings are optional, and remote is a second decision

Off by default. A remote provider needs `--allow-remote-embeddings` on top of
`--embeddings`, because agreeing to compute embeddings is not the same decision
as agreeing to upload document text. A non-https endpoint is refused.
Credential-shaped documents are never embedded at any setting. Raw vectors live
in the tool-owned cache and appear in no emitted document — reports carry vector
digests instead.

No model ships. The provider is an interface an operator implements; enabling
embeddings without one fails with that stated, rather than embedding nothing and
reporting a coverage of zero as though a model had run.

### The Repository Model Packet is not an input or an output

Nothing in this pass writes to a packet. Enabling or disabling semantic analysis,
embeddings included, cannot change a packet id or a semantic hash.

## Scope amendment: text formats only

This contract's prerequisite gate required "structured locators for decoded
binary document formats", and its stage-3 qualification required PDF, DOCX,
PPTX, XLSX and IPYNB candidates. **No binary document format is decoded by this
package** — those extensions are enumerated in `UNDECODED_DOCUMENT_EXTENSIONS`
precisely because nothing opens them — and the contract separately forbids adding
decoders. The gate could not pass as written.

The scope was amended, with the repository owner's authorization, to the text
corpus that exists: the extensions the decoders already claim. The binary-format
prerequisite and the cross-format qualification stage are dropped, not deferred
silently. Adding those decoders remains open work and is out of scope here.

The gate's other missing item — a machine-readable normalized-document index —
*was* built, as `corpus_documents.ts`, because the semantic pass genuinely
requires it and it could be satisfied honestly.

## Consequences

Candidate discovery scales past all-pairs: pairs are proposed by inverted
indexes, terms above a posting ceiling are skipped as blocking keys, and the skip
is reported rather than silent. `referenceFixtureComparison` proves the blocked
set loses nothing on a corpus small enough to score both ways.

Recall differs between the two entry points, and the difference is real rather
than incidental. Corpus mode has the lexical cache's term counts, so keyphrases
draw on document bodies. The single-source path does not, so its keyphrases come
from titles, headings and declared identifiers only. It is documented as a
difference in recall, not hidden.

`declared_service_names` is present in the feature view and always empty: no
extractor in this release declares a service name. The field is kept because a
pair signal is defined over it, and an absent field would read as "none were
declared" rather than "nothing here can declare one".

Two defects found by running the pass against a real corpus rather than only
against fixtures are worth recording, because both were invisible to unit tests
that supplied evidence directly:

- a declared `Depends on:` produced no graph edge, so the most common way one
  document points at another contributed nothing;
- every project candidate holding two distinct files became a consolidation
  candidate, because "multiple versions" had been read as "more than one content
  hash" — true of a project holding a plan and a spec, and a false positive on
  every multi-file project.

## Alternatives considered

**Replace the existing lexical topic and container project candidates.**
Rejected: they answer different questions under different methods, they are
already consumed, and the contract asked to extend rather than replace. The
semantic layer emits its own documents and its own schemas alongside them.

**Community detection instead of connected components.** Rejected for v1: a
component is a claim a person can check by following edges that are all in the
output. A modularity score is not checkable that way, and the first version of a
candidate layer should be auditable before it is clever.

**Let a strong embedding score admit a project candidate.** Rejected outright.
It is the single promotion this design exists to prevent.
