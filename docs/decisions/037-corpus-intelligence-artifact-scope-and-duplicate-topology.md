# ADR-037: Corpus intelligence is artifact-scoped evidence plus two separately-classed duplicate analyses

- **Status:** Accepted
- **Date:** 2026-08-22
- **Related:** [ADR-030](030-repository-model-packet-egress.md),
  [ADR-032](032-deterministic-repository-interpretation-seam.md),
  [ADR-036](036-read-only-local-source-acquisition.md)

## Context

ADR-036 made it safe to point this package at a folder, a drive, or a ZIP full of
years of accumulated work. What came back was an inventory and a small set of
repository-level assertions. For a *repository* that is the right shape. For a
*corpus* it is close to useless, for three separate reasons.

**Every assertion collapsed onto one subject.** `interpretRepository` took a single
`subjectId` and handed it to every extractor, and `buildRepositoryModelPacket` then
rewrote `subject_id` on every assertion to the repository id regardless. So a folder
of two hundred plans could report `work.status = wip` and `work.status = complete`
about "the repository" and nothing about which plan said which. The evidence was
technically preserved — each assertion still cited its file and line — but the graph
the packet describes had no edge from a claim to the artifact that made it, and a
consumer would have to re-parse `source_path` strings to rebuild one.

**Nothing read what the documents said about themselves.** The existing extractors
recognize manifests, service specs, canonical-authority lists and README status
admonitions. A corpus of plans, notes, drafts and roadmaps states its work state in
frontmatter fields, `Status:` lines, checkboxes, `Milestone:` labels and `Depends on:`
pointers, and none of that was read.

**Acquisition knew about duplicates and threw the answer away.** `local_source`
assembled a unified record set of physical files and virtual archive members — the
exact input a duplicate clustering needs — and then set `duplicates: []`. The single
most common shape a real corpus has, the same file sitting on disk and inside three
different backup ZIPs, was invisible.

Underneath all three sits one risk. The moment a tool starts summarizing a corpus, the
pressure to be *useful* pushes it toward judgement: this file is abandoned, these two
are the same thing, that one should be deleted. Those are conclusions a person owns.
A tool that makes them and is wrong is worse than a tool that makes none, because the
wrongness is invisible at the point it gets acted on.

## Decision

### Assertion subjects are scoped, and the packet stops rewriting them

`Extractor` gains an optional `subjectScope` of `"repository" | "artifact"`, absent
meaning `repository`. An extractor never changes scope because the interpreter learned
to support both: every pre-existing extractor keeps the subject it always had.

`interpretRepository` resolves the subject per extractor and per file, and the subject
enters assertion identity, so the same predicate about a repository and about one of
its files cannot collide on one `assertion_id`.

`buildRepositoryModelPacket` preserves the subject it is given instead of overwriting
it, and producer validation widens `assertions_resolve_to_a_subject` from "a repository
in this packet" to "a repository *or an artifact* in this packet". An assertion naming
neither still fails validation, so preserving the subject cannot strand one.

Artifact identity is now computed by one exported helper, `repositoryModelArtifactId`,
called by both packet building and interpretation. Two implementations of the same
formula would eventually drift, and the failure mode is silent: every artifact-scoped
assertion becomes an orphan.

The wire contract does not move. `l9.repository-model` stays at `1.1.0`: assertion
`subject_id` was already an unconstrained string on both sides, and the bound consumer
accepts artifact subjects with no translation shim. This was verified against the real
`load_repository_model_bundle` + `RepositoryModelV1Adapter` boundary, not asserted.

### Work intelligence reads declarations, never signals

Two artifact-scoped extractors, `document-structure/v1` and `work-intelligence/v1`,
read UTF-8 `.md`, `.markdown`, `.txt` and `.rst` within the existing interpretation
size limit and secret-path refusal. They emit titles, headings, `work.status`,
`work.kind`, open and completed tasks, milestones, and the five explicit relation
predicates (`depends_on`, `blocked_by`, `references`, `supersedes`, `superseded_by`).

Every rule recognizes a form the author chose deliberately. Status comes from a
frontmatter field, an explicit `Status:`/`State:` line, a leading blockquote
admonition, or a bracketed title marker — never from file age, TODO count, path, or
the absence of a signal. Kind comes from a frontmatter `type`/`kind` or a kind word
named outright in the title — never from the body's theme. A bare `WIP` or `DRAFT` is
read from a title because those are markers; the rest of the status vocabulary is
ordinary English, so `# Complete Guide to Routing` is a title, not a completed
document.

Contradictions survive. A document declaring `Status: WIP` at the top and
`Status: Complete` at the bottom emits both. Reconciliation needs the whole corpus in
view and belongs downstream.

The interpretation profile moves to `1.1.0`, which moves the semantic identity of every
packet built with it. That is the intended effect: the observation policy changed.

### Exact duplicates are facts; near-duplicates are candidates

These are two different epistemic classes and the code, the wire shape and the report
wording all keep them apart.

*Exact*: two artifacts are duplicates when both carry a known content hash and those
hashes are equal. Acquisition now runs the canonical clustering over its complete
unified record set, so a physical file and a member of a nested archive land in one
cluster. Cluster identity is `duplicate-cluster:sha256:<hash>` — content, never path.

*Near*: `text-near-duplicate/v1` is the exact Jaccard overlap of unique 5-token
shingles over NFKC-normalized, lowercased, whitespace-collapsed text, at a configurable
threshold defaulting to 0.85, over documents of at least 20 tokens. Byte-identical
files are excluded, because restating a certainty as an estimate is a regression. A
candidate record carries its method, version, score, threshold and both normalized
content hashes, and it never carries a topic, a semantic-equivalence flag, or a
recommendation.

Candidate generation is optimized through a shingle index rather than all-pairs. That
is an exact optimization, not an approximation — a pair sharing no shingle scores zero
and cannot qualify at any positive threshold — and the tests hold the indexed generator
to a bounded all-pairs reference at six thresholds.

### `DUPLICATE_OF` lives in the corpus index, not in the packet

`RepositoryModelEdgeType` is the bound consumer's vocabulary and it does not own a
duplicate edge. Adding one from the producer side would be a private wire variant, and
reusing `DERIVED_FROM` or `MEMBER_OF` to mean "duplicate" would be worse: it would put
a false statement into a contract another repository reads.

So exact duplicate topology is rendered in `corpus-index.json`, sourced from the
canonical `InventoryResult.duplicates`. Each non-representative member gets one
`DUPLICATE_OF` relation to the cluster representative — a star, not the n(n-1)/2 pairs
— and every relation carries `duplicate_cluster_id` and `symmetric: true` so the
equivalence cannot be misread as hub-and-spoke. Promoting `DUPLICATE_OF` into the
canonical edge vocabulary is a future cross-repository contract change.

The representative is chosen by shortest path, then code point. It exists so a graph
has a centre to draw toward. It is never called a keeper, a canonical copy, or an
original, and the report says outright that naming one implies nothing about which
copy anything should be done with.

### The corpus index is a projection

`corpus-index.json` (`l9.corpus-index/v1`) and `corpus-report.md` derive entirely from
four inputs: the acquisition observation, the emitted packet, the exact-duplicate
clustering, and the near-duplicate analysis. The index resolves every artifact,
assertion, relation endpoint and candidate endpoint against the packet, so a reference
that does not resolve is never written. The report reads the index and nothing else,
which is what makes it unable to disagree with it.

Both are byte-deterministic: code-point key ordering at every depth, no wall clock, no
absolute or scratch path. The analysis profile hash binds the work extractor versions,
both duplicate algorithm versions and the threshold, so two indexes can be compared
without guessing which rules produced each.

## Consequences

- A corpus now answers "which document said this" rather than "something in here said
  this", and the answer survives the packet boundary into topology.
- Every packet built with interpretation gets a new semantic hash. The golden bundles
  and the recorded topology-conformance evidence were regenerated against the real
  consumer.
- The near-duplicate pass reads eligible document text, which acquisition alone does
  not. It runs after the packet is built and before staging is disposed, and it is
  skippable with `--no-near-duplicates` without affecting exact duplicates.
- Nothing is moved, deleted, rewritten or consolidated, and no file outside a
  tool-owned output directory is written. The CLI still refuses to write beside the
  source it observed.

## Alternatives rejected

**Bump the packet version to 1.2.0.** No assertion field changed and no consumer
constraint was relaxed; a version bump would have forced every consumer to widen its
accepted set for a change none of them can observe.

**Emit `artifact.duplicate_of` as an RMP assertion.** Assertions require a source span
and a hashed text excerpt. Exact duplication is a property of bytes, including binary
bytes, and manufacturing a synthetic span to carry it would corrupt what an assertion
means. The predicate is reserved and deliberately unused here.

**Split comma-separated relation targets.** `Depends on: a.md, b.md` reads naturally as
two targets, but splitting is this module asserting a cardinality the author did not
write. The exact normalized declared string is carried instead.

**Infer status from staleness, TODO counts or paths.** This is the whole reason the
profile is worth having. A file untouched for two years is a file untouched for two
years; whether the work is abandoned is a judgement its owner makes.
