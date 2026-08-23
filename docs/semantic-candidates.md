# Semantic candidates and the reasoning handoff

Exact duplicates find the file you copied. Near-duplicates find the file you
copied and then edited. Neither finds the case an archaeology tool exists for:
one body of work under three names across two disks, where no two files are
duplicates and the vocabulary drifted between 2019 and 2023.

This pass finds candidates for that. Everything it produces is a candidate, and
the word is meant literally — it is offered for inspection, and it is not a
conclusion about what anything is or what should happen to it.

**This package calls no model.** Not here, not anywhere. Embeddings are an
optional recall aid that maps text to a vector; they never return a label, a
topic, a name, a summary or a recommendation. The reasoning queue below decides
*which* candidates a future model would be worth spending on, and stops there.

## What is computed

| Stage | Module | Produces |
|---|---|---|
| Feature view | `corpus_semantics` | one flat record per artifact, from recorded evidence only |
| Keyphrases | `corpus_semantics` | TF-IDF terms under `corpus-keyphrases/v1` |
| Pair signals | `corpus_pairs` | nine independently-computed signals per pair |
| Fusion | `corpus_fusion` | topic, project and consolidation candidates |
| Routing | `corpus_reasoning` | `reasoning-candidates.jsonl` |
| Evidence packs | `corpus_reasoning` | `reasoning-evidence-packs.jsonl` |
| Embeddings *(optional)* | `corpus_embeddings` | cosine pair scores, off by default |

Nothing re-reads the source. The pass runs over the assertions the interpretation
already recorded and the term counts the lexical cache already holds — which is
the point rather than an optimization. An analysis free to re-open files is free
to see something the packet cannot justify, and every conclusion drawn from it
would then be uncheckable.

## Lexical similarity

Two documents are lexically similar when they share *words*, measured four ways:
overlap of title tokens, of heading tokens, of weighted keyphrases, and the
existing near-duplicate shingle score.

Keyphrases are TF-IDF over a versioned profile: a term scores highly when it is
frequent in one document and rare in the rest of the corpus. Fields are weighted
— title 4, headings 3, declared identifiers 3, body 1 — because a word in a title
is evidence about a whole document and the same word in one paragraph is evidence
about that paragraph.

The profile binds tokenizer, stopword list, stemmer, weighting algorithm and
field weights into one hash. The stemmer is deliberately the smallest useful
rule: strip a trailing plural `s`, skipping `-ss`, `-us`, `-is`, `-as`, `-os`,
which are not plurals. `documents` and `document` should match; `analysis` must
not become `analysi`.

A high-scoring term is a term the document uses distinctively. It is not the
document's topic, and nothing here calls it one.

## Semantic similarity

Optional, off by default, and the only thing in this package that can leave the
machine.

Lexical analysis cannot see that *"persist temporal assertions in the knowledge
graph"* and *"store time-aware facts in durable semantic memory"* are about one
subject — they share almost no words. Embeddings exist for that case and no
other.

**Embeddings are not truth.** A cosine of 0.99 is a `model_derived_candidate`. On
its own it is capped at `weak`, it can never admit a project candidate, and it is
never routed for reasoning. That cap is not about confidence: it is about what
kind of evidence a model's opinion is.

### Privacy

| Rule | Behaviour |
|---|---|
| Default | disabled |
| Remote provider | needs `--allow-remote-embeddings` *in addition to* `--embeddings` |
| Remote endpoint | must be `https://`, refused otherwise |
| Secret-candidate documents | never embedded, at any setting |
| What is sent | bounded normalized text: title, headings, capped chunks |
| What is never sent | raw bytes, whole archives, absolute paths, the cache |
| Raw vectors | tool-owned cache only; never in the packet, index, or any report |

Reports carry a vector *digest* per artifact, plus provider, model, revision,
artifacts sent and chunks sent — enough to audit a remote run without reproducing
its content.

### Reproducibility

A pinned local model is `reproducible_when_runtime_pinned`. A remote provider is
`provider_bound`, and this package will not claim a fresh remote call is
bit-identical. What is guaranteed either way is replay from the content-addressed
cache, keyed on the normalized document, the chunk profile, the provider, the
model and its revision.

**No model ships with this package.** `EmbeddingProvider` is an interface for an
operator to implement. Enabling embeddings without one fails saying exactly that,
rather than embedding nothing and reporting a coverage of zero as though a model
had run and found nothing.

## Evidence families, and why corroboration is counted by family

Title overlap, heading overlap and keyphrase overlap look like three agreeing
signals. They are one document's vocabulary measured three ways, and they agree
because they must.

So evidence is counted by **family**:

| Family | Signals |
|---|---|
| `lexical` | title overlap, heading overlap, keyphrase overlap, near-duplicate, exact duplicate |
| `declared_identity` | declared identifier match |
| `graph` | explicit reference, explicit dependency, dependency overlap |
| `semantic_model` | embedding similarity |
| `context` | shared archive ancestry |

Three lexical metrics count once. Without that rule, any two documents written by
one person in one house style corroborate themselves into a strong candidate.

`context` is the weakest thing here and corroborates nothing. Two files sharing an
archive is a fact about where they are, not about what they are, and a pair whose
only signal is shared ancestry produces no candidate at all.

### Confidence classes

| Class | Meaning |
|---|---|
| `weak` | one signal, or an embedding score alone |
| `moderate` | two independent families, **or** one strong source-declared relationship, **or** two strong metrics within one family |
| `strong` | two independent families both supporting strongly |

The third clause of `moderate` resolves a gap in the governing contract, which
defined `weak` as one signal and `moderate` as two families and named no class
for several strong metrics inside one family. It resolves upward and no further:
`strong` still needs two independent families, so within-family corroboration can
never on its own produce a strong relationship, and an embedding score can never
reach it at all — that family has one metric and cannot corroborate itself.

## The three candidate types

### `TOPIC_CANDIDATE`

The members show evidence of discussing related subject matter.

Connected components over `moderate` and `strong` edges. Weak edges are excluded
because they are exactly what chains unrelated documents into one enormous
component — the failure that makes clustering output useless rather than merely
wrong.

**It does not mean the members are one project**, that any of them is current, or
that anything should be done with them.

### `PROJECT_CANDIDATE`

There is evidence these may belong to one body of work.

Admitted only on **declared identity** (two manifests naming the same project),
an **explicit graph edge** (one document referencing or depending on another), or
**corroborated similarity** (two independent families, one of them declared
identity, graph, or lexical).

Never admitted on an embedding score alone. Never admitted on a shared folder or
archive. Exact duplication alone does not qualify either: a copy proves a copy
happened, and copies cross projects routinely.

No name is synthesized. Identifiers in the record are ones a manifest declared.

Ambiguity is flagged rather than resolved: `conflicting_status`,
`multiple_declared_project_names`, `ambiguous_supersession`,
`mixed_version_lineage`, `weakly_connected_members`.

### `CONSOLIDATION_CANDIDATE`

A person may want to look at these together.

Admitted on an exact-duplicate cluster, a near-duplicate edge, a declared
supersession, or a project candidate holding genuine version lineage — meaning a
near-duplicate edge or a supersession *among its members*, not merely two
different files.

The record carries `unique_content_variant_count`, which is the number that
decides whether anyone needs to read anything: a group whose members are all
byte-identical has one variant and nothing to adjudicate.

The record deliberately has no `keeper`, no `canonical_copy`, no `merge_into`, no
`delete_these_files` and no `recommended_action`. Candidate means *inspect
together*, not *perform consolidation*.

## Why exact duplicates do not need a model

They are already decided. Two byte-identical files are a fact established by a
hash; there is no question a model could answer about them. Routing them to a
reasoner spends attention to be told what the hash already said.

This is the single largest saving in the queue, because exact duplicates are
usually the most numerous finding on a real disk.

## The reasoning queue

`reasoning-routing/v1` answers one question per candidate: is there anything here
a model could settle that the evidence has not already settled?

| Trigger | Routed to |
|---|---|
| exact duplicates only | `NONE` |
| weak single-signal candidate | `NONE` |
| embedding-only candidate | `NONE` |
| strong topic candidate, ≥2 independent families | `SAME_BODY_OF_WORK_ADJUDICATION` |
| project candidate with conflicting declared statuses | `CONFLICT_RESOLUTION_ANALYSIS` |
| supersession declarations over a mixed lineage | `SUPERSESSION_ANALYSIS` |
| cross-archive project candidate with duplicate clusters | `VERSION_EVOLUTION_ANALYSIS` |
| project candidate with several declared names | `PROJECT_IDENTITY_ADJUDICATION` |
| consolidation candidate with several content variants | `CONSOLIDATION_ANALYSIS` |

Every routed candidate carries a `reason`, including the ones routed to `NONE`,
so the refusals are checkable rather than invisible.

**"Reasoning eligible" is not a compliment.** It does not mean a candidate is
important, correct, or strategically valuable. It means the evidence is ambiguous
in a way that reading might resolve — which is the one thing a deterministic layer
genuinely cannot do.

## Evidence packs

One bounded pack per reasoning-eligible candidate: the exact grounded material a
future reasoner would receive, and nothing else.

Selection is deterministic, in priority order:

1. explicit conflicting assertions
2. explicit supersession or reference evidence
3. titles and headings
4. strongest similarity evidence
5. representative work signals

Bounded by `maxArtifactsPerPack` (12), `maxExcerptsPerArtifact` (6),
`maxExcerptCharacters` (240) and `maxTotalPackCharacters` (24 000). When a
candidate exceeds the budget the **complete member id list is preserved**, the
included evidence is the deterministically-selected subset, and `truncation`
records exactly what was left out and under which policy.

Packs never contain raw embedding vectors, secret content, or a dump of the
corpus.

## Running it

```bash
npm run local-source -- --root /Volumes/OldSSD --root /Volumes/Backup --out ./out
```

Writes, in addition to the existing corpus outputs:

```text
<out>/
  document-index.json               normalized documents: artifact, source hash, decoder
  semantic-relations.json           pair signals and their classifications
  topic-candidates.json
  project-candidates.json
  consolidation-candidates.json
  reasoning-candidates.jsonl        one routing decision per line
  reasoning-evidence-packs.jsonl    one bounded pack per eligible candidate
```

| Flag | Effect |
|---|---|
| `--no-semantic-analysis` | skip candidate discovery; duplicates and coverage are unaffected |
| `--embeddings` | enable optional embeddings (default off) |
| `--embedding-provider NAME` | required with `--embeddings` |
| `--embedding-model ID` | required with `--embeddings` |
| `--embedding-locality local\|remote` | default `local` |
| `--embedding-endpoint URL` | required for a remote provider; must be `https://` |
| `--allow-remote-embeddings` | permit a remote provider to receive bounded document text |
| `--reasoning-pack-max-artifacts N` | members per pack, default `12` |
| `--reasoning-pack-max-chars N` | characters per pack, default `24000` |

The similarity thresholds (`0.75` to offer a pair, `0.85` to count it strong) are
**not** CLI flags. This release ships no embedding provider, so `--embeddings` is
refused and a threshold flag could not take effect; they are set programmatically
via `FusionOptions.embeddingStrongThreshold` and `RunEmbeddingsInput.pairThreshold`
by a caller that supplies its own provider. A flag that cannot change anything is
worse than no flag.

Single-source mode (`npm run local-source -- <path>`) runs the same pass and
extends `corpus-index.json` and `corpus-report.md` with it. **Recall differs**:
corpus mode has the lexical cache's term counts, so its keyphrases draw on
document bodies, while single-source keyphrases come from titles, headings and
declared identifiers only.

## Scale

Ten thousand artifacts is fifty million pairs, and almost all of them share
nothing. Pairs are therefore *generated* from inverted indexes — shared
keyphrase, title token, declared identifier, resolved reference, near-duplicate
edge, duplicate cluster — and only generated pairs are scored. A pair no index
proposes is absent rather than zero.

A term appearing in more than 64 documents is not used as a blocking key: it
would propose thousands of pairs and discriminate nothing. It still contributes
to the score of pairs proposed on other grounds. The skip is reported in
`semantic-relations.json` under `generation`, because a cap nobody can see reads
as coverage nobody has.

`referenceFixtureComparison` scores a corpus both ways and reports any pair the
blocked set missed, so the scalability claim is checked rather than argued.

## Known limitations

- **Text formats only.** No PDF, DOCX, PPTX, XLSX or IPYNB is decoded, so their
  content participates in nothing here. They are counted as unsupported in the
  coverage report.
- **`declared_service_names` is always empty.** No extractor in this release
  declares a service name; the manifests read here name packages and modules. The
  field exists because a pair signal is defined over it.
- **No embedding provider ships.** The interface is exported for an operator to
  implement.
- **Reference resolution is conservative.** A written reference resolves by exact
  root-relative path, or by basename when that basename is unique in the corpus.
  Two files called `README.md` make a bare reference ambiguous, and an ambiguous
  reference is treated as no evidence rather than as a guess.
