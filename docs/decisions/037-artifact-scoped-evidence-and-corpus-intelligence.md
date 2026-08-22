# ADR-037: Artifact-scoped evidence, and a corpus layer that stops at evidence

- Status: Accepted
- Date: 2026-08-22
- Supersedes: none
- Superseded by: none
- Related: [ADR-032](032-deterministic-repository-interpretation-seam.md), [ADR-036](036-read-only-local-source-acquisition.md)

## Context

ADR-036 made it safe to observe an arbitrary local source — a folder, a drive
tree, a ZIP, a ZIP inside a ZIP — without touching it. What came back was an
inventory and a packet describing *what exists*. Three things it could not say:

**Which file said it.** `interpretRepository` took one `subjectId` and gave it to
every extractor, and `buildRepositoryModelPacket` then rewrote every assertion's
subject to the repository ID. A plan declaring `Status: WIP` produced an
assertion that the *repository* was WIP. For a corpus that is one folder holding
forty unrelated documents, that is not a small imprecision — it is the loss of
the only fact worth having.

**What the documents declare about their work.** No extractor read a title, a
heading, a status, a task, a milestone, or a declared dependency.

**Which files are the same file.** `local_source` assembled a unified record set
covering physical files and virtual archive members, then set `duplicates: []`.
The cluster builder existed and was never called on that set.

## Decision

### Assertions may be scoped to an artifact

`Extractor` gains `subjectScope?: "repository" | "artifact"`, defaulting to
`repository`. Interpretation resolves the subject per extractor per file, and the
packet builder preserves whatever subject arrives instead of overwriting it.
Producer validation accepts a subject that resolves to either a repository or an
artifact in the same packet, and rejects anything else as an orphan.

`artifactIdFor(repositoryId, sourcePath)` becomes the single artifact identity
function, exported and used by both packet building and interpretation. Two
implementations of that rule would drift, and the drift would surface only as a
validation failure far from its cause.

The packet version stays **1.1.0**. No field changed shape: `subject_id` was
already a string, and the bound consumer never constrained it to repository IDs.
The interpretation profile version moves to **1.1.0**, because what the profile
observes did change.

### Work intelligence is reading, not inference

Two artifact-scoped extractors — `document-structure/v1` and
`work-intelligence/v1` — read Markdown and plain text for titles, headings,
declared status and kind, checkbox and `TODO:` tasks, milestones, and declared
dependency, reference and supersession relations.

Every rule requires an explicit declaration site. Status comes from frontmatter,
a `Status:`/`State:` label, a leading admonition, or a marker in the title —
never from a file's age, its path, its TODO count, or the absence of open tasks.
Kind comes from a declared field or a title that names it — never from the theme
of the body. A task comes from checkbox or `TODO:` syntax — never from the word
"todo" in a sentence. Fenced code is skipped, so documentation of syntax is not
mistaken for a declaration.

Contradictions survive. A document stating both `Status: WIP` and
`Status: Complete` emits both. Reconciliation needs context a parser does not
have, and picking one silently would destroy the evidence that the document
disagrees with itself.

### Exact duplicates are facts; near-duplicates are candidates

Two artifacts are exact duplicates when both have a content hash and the hashes
are equal. Nothing else qualifies. The cluster builder now runs over the unified
record set, so a file, its copy in another folder, and a copy inside a nested ZIP
land in one cluster. Locale-aware ordering is gone from the builder: a hash taken
over a locale-ordered list is not reproducible.

Near-duplicate analysis (`text-near-duplicate/v1`) is exact Jaccard over unique
5-token shingles of NFKC-normalized, lowercased, whitespace-collapsed text, at a
stated threshold defaulting to 0.85. It is deterministic, and it is explicitly
**not** a semantic claim. The result is a candidate for a reader, never a
statement that two documents share a topic, a project, or a purpose, and never a
recommendation to merge or delete.

A cluster's *representative* is a rendering anchor chosen by shortest path. It is
not a keeper recommendation. Nothing in this layer has the information to make
one.

### DUPLICATE_OF lives in the corpus index, not the packet

`RepositoryModelEdgeType` is unchanged. The bound topology contract does not own
a duplicate edge, and repurposing `DERIVED_FROM` or `MEMBER_OF` to mean
"duplicate" would corrupt an edge vocabulary two repositories share. Exact
duplicate topology is therefore rendered in `l9.corpus-index/v1`, sourced from
the canonical cluster set, as one star relation per non-representative member
with the cluster ID on every edge.

### The corpus index is a projection

`corpus-index.json` and `corpus-report.md` read the observation, the packet, and
the two analyses. They open no source files and compute no new facts, so the
index cannot disagree with the packet it cites.

## Consequences

An assertion now names the artifact that made the claim, and an archive member's
claims attach to the member rather than to the archive or the corpus root. The
`local-source` CLI emits a machine-readable index and a human report alongside
the bundle it already produced. Duplicate clustering covers archive members,
which is where a synced drive's duplication actually lives.

Both golden bundles were regenerated: the interpretation profile bump changes
packet identity by design. The bound consumer at
`4a0313a75eef7d3556582101918d5221bbe91d78` was re-run against both and accepted
artifact-scoped subjects with no translation shim and no change to the topology
repository.

A binary file claimed by a text extractor is now reported as
`interpretation.binary_detected` rather than as an encoding fault. A `.txt`
holding image bytes is not a broken encoding, and one inventory should not
conflate the two.

What this deliberately does not do: topic clustering, embeddings, LLM
interpretation, project grouping, prioritization, roadmap generation,
consolidation recommendations, or any file movement or deletion. Those need a
trustworthy artifact-level substrate first, which is what this provides.

## Alternatives considered

**Bump the packet to 1.2.0.** Rejected: no field changed shape, and a version
bump the consumer must be taught about buys nothing when the existing contract
already accepts the data.

**Add `DUPLICATE_OF` to the shared edge vocabulary.** Rejected for this
producer-only change. Promoting an edge into a vocabulary two repositories share
is a cross-repository decision, and the corpus index carries the topology
faithfully in the meantime.

**Reuse the near-duplicate helper in `compiler.ts`.** Rejected: it is bound to
the injection pipeline's `InjectionRecord`, uses 4-token shingles and different
normalization, and changing it to match this profile would silently alter the
existing dedup report. The two coexist with separate identities.

**Exclude every clustered file from similarity analysis.** Rejected after it
silently dropped a real finding: a file with an exact twin can still be the near
twin of a third file. One representative per cluster is analysed instead, which
keeps the finding without producing N×M restatements of it.
