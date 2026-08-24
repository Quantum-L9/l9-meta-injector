# Corpus intelligence

What this package can say about a folder full of accumulated work, and — as
importantly — what it refuses to say.

Authority: [ADR-037](decisions/037-corpus-intelligence-artifact-scope-and-duplicate-topology.md).
Acquisition it builds on: [ADR-036](decisions/036-read-only-local-source-acquisition.md).

## The four layers

```text
acquisition      local_source.ts        what files exist, what bytes they hold
interpretation   interpretation.ts      what each file declares, with a cited span
corpus analysis  corpus_analysis.ts     what the set implies: duplicates, candidates
projection       corpus_report.ts       the same index, rendered for a person
```

Each layer reads only the ones above it. `corpus_analysis.ts` never re-observes the
filesystem to establish something acquisition did not, except to read the text of the
documents it scores — and that read is itself part of the near-duplicate analysis, one
of the index's four declared inputs. `corpus_report.ts` reads the index and nothing
else, which is what makes the two documents unable to disagree.

## Artifact-scoped versus repository-scoped assertions

An assertion attaches to a **subject**. Until ADR-037 there was only one.

| Scope | Subject | Reads |
|---|---|---|
| `repository` | `repo:<name>` | the repository declares something about itself |
| `artifact` | `artifact:<stable id>` | *this file* declares something about itself |

`# Deployment Roadmap` in `plans/deploy.md` is a fact about `plans/deploy.md`. Filing it
against the repository turns a corpus of two hundred plans into two hundred
contradictory claims about one subject.

An extractor opts in with `subjectScope: "artifact"`. Absent means `repository`, so no
extractor written before the scope existed changes behavior because the interpreter
learned to support both. Both scopes validate: the packet's
`assertions_resolve_to_a_subject` check accepts a repository id or an emitted artifact
id, and rejects anything else.

Artifact ids come from one exported helper, `repositoryModelArtifactId(repositoryId,
sourcePath)`, used by both packet building and interpretation. `sourcePath` is the
source-relative POSIX path or a virtual archive locator; a member of a nested archive
is subject to its own artifact:

```text
old-projects.zip!/plans/world-model.md   -> artifact:<id for exactly that locator>
```

never the outer archive, never the inner archive, and never the staging directory the
bytes were read from.

The wire contract stays at `l9.repository-model` `1.1.0`. `subject_id` was already an
unconstrained string on both sides, and the bound `l9-constellation-topology` consumer
accepts artifact subjects with no translation shim — verified against the real loader
and adapter, recorded in [`topology-conformance.json`](topology-conformance.json).

## Work intelligence is explicit evidence, not inference

Two artifact-scoped extractors read every document a decoder normalized — the UTF-8
`.md`, `.markdown`, `.txt` and `.rst` they always read, and since ADR-043 the decoded
blocks of PDF, DOCX, PPTX, XLSX, IPYNB, CSV and HTML as well — within the existing
interpretation size limit and behind the existing secret-path refusal. One implementation
reads all of them, so `Status: blocked` in a `.docx` and in the `.md` beside it produce
the same claim. What is added is a second way *in*, not a second vocabulary: no OCR, no
embedding, and no model extraction reads a signal.

| Predicate | Read from |
|---|---|
| `document.title` | frontmatter `title`, a Markdown `# H1`, a `Title:` field |
| `document.heading` | each ATX heading, as `H<level>: <text>` |
| `work.status` | frontmatter `status`/`state`, a `Status:`/`State:` line, a leading blockquote admonition, a bracketed title marker |
| `work.kind` | frontmatter `type`/`kind`, or a kind word named outright in the title |
| `work.task.open` | an unchecked Markdown checkbox, or a line beginning `TODO:` |
| `work.task.completed` | a checked Markdown checkbox |
| `work.milestone` | `Milestone:` / `Milestone <n>:`, or bullets under a `Milestones` heading |
| `work.depends_on` | `Depends on:`, `Depends upon:`, `Requires:` |
| `work.blocked_by` | `Blocked by:` |
| `work.references` | `Reference:`, `References:`, `See also:`, `Related:` |
| `work.supersedes` | `Supersedes:`, `Replaces:` |
| `work.superseded_by` | `Superseded by:`, `Replaced by:` |

Vocabularies are closed. `work.status` is one of `wip, draft, planned, blocked, paused,
active, done, complete, archived, superseded, cancelled`; `work.kind` is one of `plan,
roadmap, proposal, design, specification, notes, checklist, decision, research`. A value
outside the vocabulary produces no assertion rather than a nearest match.

What is **never** read:

- status from file age, modification time, or path;
- abandonment from anything at all;
- completion from the absence of open tasks;
- a kind from the body's theme — `# Thursday` discussing a plan is not a plan;
- a task from the word TODO inside a sentence;
- a heading or a checkbox inside fenced code;
- a duplicate from a filename.

A bare `WIP` or `DRAFT` counts as a title marker because those are markers. The rest of
the vocabulary is ordinary English, so it is read from a title only when bracketed:
`# Complete Guide to Routing` is a title, `# Routing Guide [DRAFT]` is a marked draft.
A title marker is recorded at `medium` confidence; a structured field or an explicit
label at `high`.

Contradictions survive. A document declaring `Status: WIP` at the top and
`Status: Complete` at the bottom emits both assertions, each citing its own line.
Reconciling them needs the whole corpus in view and is not this pass's job.

Every assertion carries its artifact subject, exact source path, the coordinate its own
format has — a line span for text, a page and block index for PDF, a slide and shape for
a deck, a sheet and cell for a workbook, a cell index for a notebook — bounded excerpt,
source content hash, extractor id, evidence class, confidence and authority. An assertion
that cannot cite a coordinate is not emitted, and no format without lines is ever given a
line number.

An object is a quotation, so the characters the document wrote are kept: a task
reading `- [ ] wire up user_profile_service` is recorded with its underscores
intact. Markdown emphasis is removed only where it wraps the whole value
(`**Ship the release**` becomes `Ship the release`); emphasis marking up part of a
sentence stays, because `**urgent** fix` trimmed at the edges would leave
`urgent** fix`, a string the file does not contain. Values matched against a closed
vocabulary — a status, a kind, a label name — are normalized more aggressively,
which is safe because that vocabulary has no such characters in it.

## Exact duplicates

Two artifacts are exact duplicates **if and only if** both carry a known content hash
and those hashes are identical. That is the whole definition. Names, locations, sizes
and dates decide nothing.

Because acquisition clusters over its complete unified record set — physical entries
and virtual archive members together — a cluster can span:

- two files on disk;
- a file and a member of an archive;
- two members of one archive;
- a member of a nested archive and a file on disk;
- two members of the same nested archive.

Cluster identity is `duplicate-cluster:sha256:<content hash>`. It is content-bound, so
the same corpus observed from a different mount point produces the same cluster ids.

### `DUPLICATE_OF` semantics

`DUPLICATE_OF` is rendered in `corpus-index.json`, **not** in the Repository Model
Packet. `RepositoryModelEdgeType` is the bound consumer's vocabulary and does not own a
duplicate edge; adding one from the producer side would be a private wire variant, and
reusing `DERIVED_FROM` or `MEMBER_OF` to mean "duplicate" would put a false statement
into a contract another repository reads. Promoting it is a future cross-repository
change. The predicate `artifact.duplicate_of` is reserved and deliberately unused: an
RMP assertion needs a source span, and byte duplication — which includes binary files —
is not a text span.

A cluster of *n* members has *n(n-1)/2* equivalent pairs. Rendering them all drowns a
graph in edges that say the same thing, so each non-representative member gets exactly
one relation to the representative. Every relation carries `duplicate_cluster_id` and
`symmetric: true`, so the star is readable as cluster-wide equivalence rather than as a
hub-and-spoke claim.

### The representative is not a keeper recommendation

The representative is the shortest source path, then code-point order. It exists so a
rendering has a centre to draw toward. It is **not** the original, **not** the canonical
copy, **not** the one to keep, and **not** advice. Every member of a cluster is exactly
equivalent to every other; that is what byte equality means.

## Near-duplicate candidates

A different epistemic class, kept separate everywhere.

| | Exact duplicate | Near-duplicate candidate |
|---|---|---|
| Class | fact | candidate analysis |
| Basis | content-hash equality | deterministic text similarity |
| Rendered as | `DUPLICATE_OF` | a candidate record |
| Means | the bytes are identical | the wording overlaps |

**Algorithm** — `text-near-duplicate/v1`, version `1.0.0`:

1. normalize: Unicode NFKC, CRLF/CR to LF, lowercase (analysis only), collapse
   whitespace, trim;
2. tokenize into Unicode word tokens;
3. take the unique 5-token shingles;
4. score the exact Jaccard overlap of the two shingle sets;
5. report the pair when the score reaches the threshold.

Default threshold `0.85`, configurable in `[0, 1]`. Documents below 20 tokens are not
scored. Byte-identical files are excluded — they are an exact duplicate, and restating a
certainty as an estimate is a regression. Also excluded: non-UTF-8 bytes, unsupported
extensions, credential-candidate paths, and files above the analysis size limit. Every
exclusion is counted and reported in the index's diagnostics.

Candidate generation runs through a shingle index rather than all-pairs. This is an
exact optimization, not an approximation: a pair sharing no shingle scores exactly zero
and cannot qualify at any positive threshold. The tests hold the indexed generator to a
bounded all-pairs reference implementation at six thresholds.

Candidate identity binds the algorithm id and version, the threshold, the ordered
artifact-id pair, and both normalized content hashes — so it is stable across absolute
paths and changes when the analysis rules change.

**A candidate does not mean:** same topic, same project, same effort, one supersedes the
other, they are redundant, they should be merged, or anything should be deleted. It
means the wording overlaps. Two documents about entirely different subjects can share
wording; two documents about one subject can share none.

## The corpus index is a projection, not new truth

`corpus-index.json` declares `l9.corpus-index/v1`. Every value in it is derived from:

- the acquisition observation (`LocalSourceObservation` / `InventoryResult`),
- the emitted Repository Model Packet,
- the deterministic exact-duplicate clustering,
- the deterministic near-duplicate analysis.

Top-level sections: `source`, `repository_model`, `analysis_profile`, `summary`,
`artifacts`, `work_signals`, `exact_duplicate_clusters`, `relations`,
`near_duplicate_candidates`, `archives`, `diagnostics`.

Every artifact id resolves to a packet artifact, every work-signal assertion id resolves
to a packet assertion, and every relation and candidate endpoint resolves to an artifact
in the index. A reference that does not resolve is not written.

`analysis_profile.corpus_profile_hash` binds the work extractor versions, both duplicate
algorithm versions, and the threshold. Two indexes can therefore be compared without
guessing which rules produced each.

Serialization is deterministic: code-point key ordering at every depth, absent fields
omitted, no wall clock, no absolute path, no scratch path. The same corpus content
observed from a different directory produces byte-identical outputs.

`corpus-report.md` renders the same index with fixed section order, fixed row order and
no timestamp. Its language is part of the contract: exact duplicates may be called
byte-identical, candidates must be called candidates and lexical similarity, and the
words *same topic*, *same project*, *merge these*, *delete this*, *redundant*, *keeper*
and *canonical copy* appear nowhere in it.

## Two projections of the work signals, and which one a consumer reads

The work signals are written twice, for two different readers, and the difference is a
contract rather than an accident.

`document-signals.json` is the **human projection**. It is meant to be opened, so its
per-format record listing stops at `MAX_LISTED_SIGNALS_PER_FORMAT` (50). A tracker
stating ninety-one things contributes fifty listed records, and the entry says so:
`signal_count` is 91, `listed_signal_count` is 50, `omitted_signal_count` is 41. The
counts are always complete. Only the listing is sampled, and the sampling is declared on
the same object rather than left to be discovered by subtraction.

`document-work-signals.jsonl` is the **machine projection**, and it is never sampled at
any corpus size. One JSON object per line, ordered by `artifact_id`, `block_id`,
`predicate`, `object`, `signal_id`, so two runs over the same corpus produce the same
bytes. Raising the report's ceiling is not a substitute for it and neither is setting the
ceiling to a large number: a bound that is large is still a bound, and a consumer cannot
tell a corpus that stated less from a report that listed less.

`document-work-signals.manifest.json` is what makes the payload trustworthy on arrival:

| Field | What a consumer does with it |
|---|---|
| `record_count` | count the lines and compare |
| `payload_byte_length` | check the bytes are all there |
| `payload_artifact_hash` | SHA-256 of the exact UTF-8 bytes — proves nothing was rewritten |
| `payload_semantic_hash` | SHA-256 over the canonical records — survives the file being moved or re-encoded |
| `by_format`, `by_predicate` | per-group totals, which must sum to `record_count` |

Every record carries **both** identities, because the two live in different domains and
guessing between them is how a consumer silently drops half a corpus:

- `artifact_id` is the corpus identity (`vsrc:…`), which resolves in `corpus-index.json`
  and `document-index.json`;
- `rmp_artifact_id` is the identity that artifact has *inside its own root's Repository
  Model Packet* (`artifact:…`).

A consumer that compiles per-root packets joins on `rmp_artifact_id`. A consumer working
against the corpus projection joins on `artifact_id`. Neither has to derive one from the
other, and neither has to read a path to find out which artifact a signal belongs to.

Both files sit in the generation directory beside the rest, are published by the same
atomic `CURRENT.json` rename, and are named in `corpus-index.json` under
`document_work_signals` and `document_work_signals_manifest`.

## A root nobody named cannot carry history

A root has a key, and the key has a class. It is **declared** when an operator supplied
it — `--root /Volumes/OldSSD=OldSSD`, or a `l9.corpus-roots/v1` manifest — and
**inferred** when nothing did, in which case it is the final path segment. A session
written before this field existed carries no class and is read as inferred, which is the
safe direction rather than the convenient one.

An inferred key is perfectly good for a single run. It is not an identity across runs:
`/Volumes/Backup` and `/mnt/nas/Backup` are two different drives that infer the same key,
and nothing in the corpus can tell them apart afterwards. Three operations assert that a
root is the root it was last time —

- `--previous-snapshot` (previous-snapshot diff),
- `--resume` (adopting completions recorded against a root id),
- `--incremental` (carrying a previous run's content hash forward),

— and all three **refuse to run**, before any file is opened, when either side of a
matched root rests on an inferred key. The refusal names the operation, the root key,
both identity classes, and the two ways forward. Roots that were added or removed make no
continuity claim and are not considered.

`--allow-inferred-root-history` is the operator saying the basenames really do name the
same drive. It authorizes the comparison and nothing else: the key stays inferred, the
snapshot's semantic identity is unchanged, and the override is recorded in the snapshot's
`operational_provenance` and reported as a `corpus.inferred_root_history_override`
diagnostic — so a run that leaned on it is distinguishable afterwards from one that did
not. A warning printed while continuing would not be that, which is why continuing is not
what happens without the flag.

## Nothing is moved, deleted or consolidated

This layer observes. It does not move a file, delete a file, rewrite a file, plan a
reorganization, choose a keeper, prioritize work, or generate a roadmap. The CLI refuses
to write its outputs inside the tree it observed, and the source checksum before an
observation equals the checksum after it.

## Not in v1

Topic clustering, semantic embeddings, a vector database, LLM summarization or
classification, `SAME_TOPIC` edges, project clustering or naming, roadmap generation,
build prioritization, consolidation recommendations, file-move plans, file deletion,
automatic keeper selection, PDF/DOCX/PPTX/XLSX extraction, OCR, image understanding.

The order is deliberate. A trustworthy artifact-level evidence substrate comes first;
higher-order grouping and strategic judgement come after it has been run against real
archives.

It has been, and [ADR-038](decisions/038-multi-root-corpus-incremental-cache-and-readiness-evidence.md)
takes two items off that list: **topic candidates** and **project candidates**, both
deterministic, both lexical or marker-based, and both labelled candidates for the same
reason near-duplicates are. See [corpus-archaeology.md](corpus-archaeology.md), which
also covers multi-root corpora, the content-addressed cache and readiness evidence.

[ADR-040](decisions/040-semantic-candidate-discovery-and-reasoning-handoff.md) takes two
more: **optional semantic embeddings**, off by default and never able to establish
anything on their own, and a **deterministic reasoning queue** that routes ambiguous
candidates to a future model without calling one. See
[semantic-candidates.md](semantic-candidates.md).

Everything else above stays where it is. No `SAME_TOPIC` edge is written, no project is
named, no roadmap is generated, no build is prioritized, no consolidation is performed,
no file is moved or deleted, no keeper is selected, no binary document format is
extracted, no OCR is run, and **no model is called anywhere in this package**.

## Running it

```bash
npm run local-source -- <path> --out <dir>
```

Adds to the existing output layout:

```text
<out>/
  bundle/
    manifest.json
    packet.json
    receipts/validation-receipt.json
  local-source-manifest.json
  corpus-index.json
  corpus-report.md
```

Corpus mode (`--root`) additionally writes the document index and the semantic
candidate set — see [semantic-candidates.md](semantic-candidates.md).

| Flag | Effect |
|---|---|
| `--near-duplicate-threshold F` | lexical similarity threshold in `[0, 1]`, default `0.85` |
| `--no-near-duplicates` | skip the similarity pass; exact duplicates and every other corpus output are unaffected |

## Operating at scale

Multi-root corpora, the corpus manifest, the two identities a corpus carries,
verification modes, partial corpora, the archive budget and resume semantics are
described in [`corpus-scale-operation.md`](corpus-scale-operation.md). What the
content-addressed cache is keyed on, what it refuses to hold, and why it is never
an authority is in [`corpus-cache.md`](corpus-cache.md).
