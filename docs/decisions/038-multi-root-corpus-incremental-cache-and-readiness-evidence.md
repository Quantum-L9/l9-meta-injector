# ADR-038: A corpus spans several roots, reuses content-addressed work, and emits readiness evidence without ranking it

## Status

Accepted. Extends [ADR-036](036-read-only-local-source-acquisition.md) (read-only
acquisition) and [ADR-037](037-corpus-intelligence-artifact-scope-and-duplicate-topology.md)
(artifact-scoped evidence and duplicate topology). Neither is superseded: both
still describe how a single source is observed and how its index is projected.

## Date

2026-08-23

## Context

ADR-037 shipped corpus intelligence against one source at a time and listed
topic clustering, project clustering and any strategic judgement as explicitly
out of scope, on the stated grounds that a trustworthy artifact-level substrate
should come first and be run against real archives.

It has been. Three things the substrate cannot do turned out to be the ones that
matter on a real archive:

1. **A real archive is not one folder.** It is an old SSD, a backup volume and a
   directory of ZIPs, and the same document is on all three. Analyzed one root at
   a time, the duplicate that matters — the one spanning the disks — is invisible
   by construction, and so is the project whose files are split across them.

2. **A full rescan is the only mode.** Every run re-decodes, re-interprets and
   re-tokenizes every document, including the ones whose bytes have not moved
   since the last run. On a corpus of ten thousand artifacts that is most of the
   cost of the run, and on a corpus large enough to be interesting it is most of
   the reason nobody runs it twice.

3. **A downstream layer cannot see what is there.** The index reports duplicates
   and declared work state. It does not report whether a body of work has tests,
   a build manifest, a CI definition or a deployment definition — the measurable
   things a strategy layer would weigh. Nor does it report what the scan could
   not read, which is the number that decides how much of the rest to believe.

Each of those has an obvious wrong answer, and the wrong answers are what this
decision is mostly about.

The wrong answer to (1) is to identify a root by where it is mounted, so that a
remounted drive becomes a new corpus and every file on it becomes an addition.
The wrong answer to (2) is to decide that a file is unchanged because its
timestamp says so. The wrong answer to (3) is to compute a readiness score, a
percentage complete or a build priority — numbers that look like the file counts
beside them and are not the same kind of thing at all.

## Options Considered

### Option A: Analyze each root separately and merge the reports

- Pros: no new identity model; the existing per-source pipeline is untouched.
- Cons: cross-root near-duplicates, topic candidates and project candidates
  cannot be recovered from per-root reports, because the analyses need every
  document's text in one pass. Merging duplicate clusters is possible; merging
  the analyses that matter is not.

### Option B: One corpus with two kinds of root identity

- Pros: duplicate and candidate analysis crosses root boundaries by construction;
  a path namespace keeps two roots' identical relative paths apart; a remount
  changes nothing.
- Cons: requires separating "which root is this" (stable across runs) from "what
  did this root contain" (changes with every byte), and requires a root to have a
  key that is neither its mount point nor its content.

### Option C: Cache derived work keyed on the file path and its mtime

- Pros: the cheapest possible incremental check; no hashing required.
- Cons: mtime is not content. A restored backup, a `touch`, a clock skew, a
  copy that preserves timestamps, or a filesystem with coarse resolution each
  produce a wrong answer, and the wrong answer is silent. It would also make the
  cache the authority on identity, which is the one thing a cache must not be.

### Option D: Cache derived work keyed on content, and hash unconditionally

- Pros: a hit and a miss are provably the same value, because the key is a
  function of the bytes and the rules applied to them. Reuse survives a rename, a
  remount and a copy between disks.
- Cons: every byte is read on every run. Hashing is not free.

### Option E: Emit a readiness score

- Pros: a single number a strategy layer can sort on.
- Cons: the number would be invented. Nothing in a file count supports a claim
  about worth, completion or intent, and a score rendered beside real counts
  inherits their authority without having earned it.

### Option F: Emit measurable signals and refuse the score

- Pros: everything emitted is a count of something observed or a citation of
  something declared; a downstream layer that wants a ranking owns the ranking.
- Cons: the consumer has more work to do, and "we will not compute that" has to
  be enforced rather than merely stated.

## Decision

We choose **B**, **D** and **F**.

### Multi-root corpus

A root carries two identities, and conflating them is the failure this decision
exists to prevent.

| | Derived from | Changes when |
|---|---|---|
| `root_id` | the root's declared key | the operator renames it |
| `root_snapshot_id` | the physical snapshot hash | any byte under the root changes |

The declared key defaults to the root's own final path segment — `OldSSD` for
both `/Volumes/OldSSD` and `/mnt/recovered/OldSSD` — and is overridable with
`--root PATH=NAME`. The parent directories, the volume prefix and the drive
letter are operational and appear in no semantic output.

`root_id` has to survive a byte changing, or a second run could not tell an
edited file from a deletion and an addition, and the diff would be useless.
`root_snapshot_id` has to change when a byte changes, or the corpus snapshot
identity would be a lie. Both are needed; neither can do the other's job.

Corpus identity is `H(sorted(root source revisions), corpus profile)`. Sorted, so
the order the roots were typed in cannot change it. Profile-bound, so a corpus
analyzed under different rules is a different snapshot even when the bytes match.

Every artifact is identified by `H(root_id, root-relative path)` and addressed as
`<root key>::<root-relative path>`. Two roots holding `notes/monday.md` hold two
artifacts. One root read from two mount points is one root: a repeated root
identity with identical content is folded with a diagnostic, and two roots that
declare one key while holding different content are refused rather than merged
into a corpus that describes neither.

Exact duplicates, near-duplicate candidates, topic candidates and project
candidates are all computed over the whole corpus, so each of them crosses root
boundaries, and each reports whether it did.

### Content-addressed cache

Six layers, each keyed on content and on the rules applied to that content:
`raw_identity`, `normalized_document`, `interpretation`, `lexical_features`,
`embedding`, `candidate_analysis`. The store defaults to `~/.l9/corpus-cache`, is
configurable, and is refused outright if it would live inside an observed root.

Acquisition — enumeration and hashing — never consults the cache. Every byte is
hashed on every run. That is the price of Option D and it buys the property that
makes the rest safe: the key of every derived layer is computable from the
content hash alone, so a warm run establishes that a document is unchanged
*before* deciding not to open it, rather than instead of deciding.

`mtime` is recorded and used as a scheduling hint only. It is compared against
the hash afterwards and the agreement rate is reported. No code path lets it skip
a hash.

Every entry carries its schema, key, payload hash and producer version, and is
verified on read. An entry that fails is deleted, recomputed and reported. A
cache is allowed to be empty; it is not allowed to be wrong.

Two deviations from a purely content-addressed key are deliberate and both are
about correctness rather than convenience:

- The **interpretation** key includes the source path. An assertion cites the
  path it was read from and is filed against that path's artifact subject, and
  several extractors read the path itself, so two identical files at two paths
  are two different interpretations.
- An interpretation whose extractors **consulted the rest of the root** — the
  `pathExists` callback — is computed and used but never stored. It is not a
  function of the document's own bytes, and a later run with a different root
  would otherwise read back an answer that had stopped being true. Whether that
  happened is discovered by observing the callback rather than assumed per
  extractor.

### Readiness evidence

Twelve artifact signals, each carrying the exact thing that decided it and which
kind of evidence that was: a filename, an extension, a path segment, or a
predicate a document declared and cited a line for. Following ADR-031, a
convention is evidence of the convention and of nothing behind it — `Makefile`
means a file named `Makefile` exists, not that the project builds.

Body-of-work aggregates are counts over the members of a project candidate. None
is combined with, weighted against, or projected from any other.

`build_priority`, `strategic_value`, `percent_complete`,
`production_readiness_score` and `abandonment_probability` are named in
`FORBIDDEN_READINESS_METRICS`, restated in every emitted document, and asserted
absent by a test that walks the document rather than by a promise.

### Coverage

`corpus-coverage.json` reports what each analysis reached as a ratio over what it
was eligible for, and separates *not supported* from *not present*: a PDF is a
text-bearing format this release does not decode and is counted by extension; a
PNG requires OCR, which this package does not perform. The reasoning handoff
points at the readiness evidence, the declared dependency assertions and the two
duplicate classes, and stops there.

### Scale, resume and atomicity

The scan is bounded rather than unbounded: concurrency and in-flight decoded
bytes are configurable budgets. A session manifest records completions by
content-addressed key, so a completion recorded by one attempt is still true for
the next and a completion that has stopped being true simply produces a different
key. Every projection is staged and renamed together, so a reader sees either the
previous complete set or the new one.

## Consequences

- Cold and fully warm runs must produce byte-identical semantic output for every
  deterministic layer. The qualification suite asserts it directly, and
  `embedding` is excluded from that promise because a remote model is not a
  function this repository can make promises about.
- The near-duplicate index was rewritten to an exact prefix-and-size filter. The
  previous shingle index enumerated every pair sharing any shingle, which on a
  ten-thousand-document corpus with a common heading exceeded the maximum size of
  a `Set` — a real limit reached by a realistic corpus, not a synthetic one. The
  new filter is held to the exhaustive reference at seven thresholds and over a
  generated corpus with shared boilerplate.
- `interpretRepository` now delegates to an exported `interpretDocumentContent`,
  so per-document interpretation has one implementation rather than two.
- `clusterExactDuplicates` joins `buildCorpusDuplicateClusters` as a second entry
  point to one clustering rule, sharing the representative-selection and ordering
  helpers. Two input shapes, one definition of duplicate.
- The corpus layer's interface is the CLI and its JSON projections, matching how
  ADR-037 shipped corpus intelligence. No package export is added, and the public
  API contract is unchanged.
- Topic candidates and project candidates leave the ADR-037 "not in v1" list.
  Everything else on it stays there: no embeddings are computed, no model is
  called, no file is moved, consolidated or deleted, and no priority is produced.
- `max_parallel_hashers` is accepted, recorded and not exercised: acquisition
  hashes each root with one streaming reader. A value above one emits a
  diagnostic saying so rather than implying a parallelism that does not exist.
