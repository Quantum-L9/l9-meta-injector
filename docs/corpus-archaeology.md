# Corpus archaeology

Reading several disks of accumulated work as one corpus, without reading any of
it twice, and without inventing a judgement about any of it.

Authority: [ADR-038](decisions/038-multi-root-corpus-incremental-cache-and-readiness-evidence.md).
Builds on [ADR-036](decisions/036-read-only-local-source-acquisition.md) (read-only
acquisition) and [ADR-037](decisions/037-corpus-intelligence-artifact-scope-and-duplicate-topology.md)
(artifact-scoped evidence, duplicate topology). The single-source pipeline those
describe is unchanged and still runs when no `--root` is given.

## Running it

```bash
npm run local-source -- \
  --root /Volumes/OldSSD \
  --root /Volumes/Backup \
  --root ~/ArchiveZips \
  --out ./corpus-out
```

or, with the roots in a file:

```bash
npm run local-source -- --root-manifest ./roots.json --out ./corpus-out
```

```json
{
  "schema": "l9.corpus-roots/v1",
  "roots": [
    { "path": "/Volumes/OldSSD", "name": "old-ssd-2019" },
    { "path": "/Volumes/Backup" },
    "~/ArchiveZips"
  ]
}
```

A plain list of paths, one per line, with `#` comments, is also accepted.

### Output

```text
corpus-out/
  corpus-snapshot.json      l9.corpus-snapshot/v1      every artifact's corpus identity
  corpus-candidates.json    l9.corpus-candidates/v1    duplicates and the three candidate classes
  readiness-evidence.json   l9.readiness-evidence/v1   signals and body-of-work counts
  corpus-coverage.json      l9.corpus-coverage/v1      what was reached, what was not
  corpus-diff.json          l9.corpus-diff/v1          against the previous snapshot, when there is one
  corpus-session.json       l9.corpus-session/v1       operational: resume state and failures
```

The first four and the diff are semantic: deterministic, code-point ordered, no
wall clock, no absolute path. `corpus-session.json` is operational and carries
both, because an operator debugging a failed run needs them.

By default the next run diffs against `corpus-snapshot.json` in the same output
directory, so running the command twice is an incremental scan with no extra
flags. `--previous-snapshot FILE` points elsewhere; `--no-diff` skips it.

### Flags

| Flag | Effect |
|---|---|
| `--root PATH[=NAME]` | add a root; repeatable |
| `--root-manifest FILE` | read roots from a manifest |
| `--cache-dir DIR` | cache root; default `$L9_CORPUS_CACHE` or `~/.l9/corpus-cache` |
| `--no-cache` | run cold: read nothing, write nothing |
| `--previous-snapshot FILE` | diff against this snapshot |
| `--no-diff` | do not produce `corpus-diff.json` |
| `--session FILE` | session manifest path |
| `--resume` | adopt an existing session manifest for the same roots |
| `--near-duplicate-threshold F` | lexical similarity threshold, default `0.85` |
| `--no-near-duplicates` | skip the similarity pass |
| `--topic-threshold F` | topic vocabulary overlap, default `0.35` |
| `--no-topic-candidates` | skip topic candidate analysis |
| `--max-parallel-decoders N` | documents decoded concurrently, default `4` |
| `--max-memory-bytes N` | ceiling on decoded text held at once, default 256 MiB |

The archive budget, omit and interpretation flags from single-source mode all
apply unchanged.

## Root identity

A root has two identities and they answer different questions.

| | Derived from | Answers | Changes when |
|---|---|---|---|
| `root_id` | the declared key | *which root is this* | the operator renames it |
| `root_snapshot_id` | the physical snapshot hash | *what did it contain* | any byte changes |

The declared key defaults to the root's own final path segment. `/Volumes/OldSSD`
and `/mnt/recovered/OldSSD` are both `OldSSD` — the same drive, plugged in
somewhere else. Everything above that segment is a fact about the mount table and
appears in no semantic output. `--root PATH=NAME` sets the key explicitly, which
is what two disks that happen to share a final segment need.

Both identities are necessary. A content-derived `root_id` would change every
time a file was edited, and the next run could not tell an edit from a deletion
and an addition. A path-derived `root_snapshot_id` would let a corpus claim to be
unchanged when its bytes had moved.

Corpus identity is `H(sorted(root source revisions), corpus profile)` — sorted, so
argument order cannot change it, and profile-bound, so a corpus analyzed under
different rules is a different snapshot.

### The path namespace

An artifact is `<root key>::<root-relative path>`:

```text
OldSSD::widget-api/PLAN.md
Backup::widget-api/PLAN.md
OldSSD::old-work.zip!/widget-api/PLAN.md
```

Its identity is `H(root_id, root-relative path)`. Two roots holding
`notes/monday.md` hold two artifacts with two ids, whatever their contents. One
root read from two mount points is one root.

A root repeated with identical content is folded, with a diagnostic naming both
mounts. Two roots that declare one key while holding different content are
refused: merging them would produce a corpus that describes neither.

## The cache

Six layers. Every key is a function of content and of the rules applied to that
content — never of a path, a mount point, a filename or a timestamp.

| Layer | Key |
|---|---|
| `raw_identity` | exact content hash |
| `normalized_document` | content hash, decoder id, decoder version |
| `interpretation` | normalized document identity, interpretation profile hash |
| `lexical_features` | normalized document identity, lexical profile hash |
| `embedding` | normalized document identity, model identity, chunk profile |
| `candidate_analysis` | every input feature identity, candidate profile hash |

Default location `~/.l9/corpus-cache`, overridable by `$L9_CORPUS_CACHE` or
`--cache-dir`. A cache root inside an observed tree is refused.

**Hashing never consults the cache.** Every byte is read and hashed on every run.
That is what makes the rest safe: the key of every derived layer is a function of
the content hash, so a warm run *establishes* that a document is unchanged before
deciding not to open it. The reuse is in decoding, interpreting and tokenizing,
which is where the cost is.

Every entry carries `schema`, `key`, `payload_hash` and `producer_version`, and
is verified on read. A failure means the entry is deleted, the value recomputed,
and a diagnostic emitted. A cache is allowed to be empty. It is not allowed to be
wrong.

### mtime

Recorded per file, compared against the hash, and reported:

```text
mtime precheck   6 predicted unchanged, 6 confirmed by hash, 0 contradicted
```

It is a scheduling hint and an accuracy report. No code path lets it skip a hash
or decide an identity.

### Three deliberate deviations

The interpretation key carries the **source path** as well as the two the table
names. An assertion cites the path it was read from, is filed against that path's
artifact subject, and several extractors read the path itself — so two identical
files at two paths are two different interpretations, and a purely
content-addressed key would serve one under the other's name.

An interpretation whose extractors **consulted the rest of the root** is computed
and used but never stored: it is not a function of the document's own bytes.
Whether that happened is observed at run time rather than declared per extractor.

The **candidate analysis** key binds each input's artifact id and corpus path as
well as its normalized content hash. The candidate documents embed artifact ids
and corpus paths, so a corpus whose documents are unchanged but *renamed* is a
different input to that analysis. Keying it on content alone reused the previous
run's answer and emitted candidates naming artifacts the new snapshot did not
contain — found in review on this change, and the reason a rename now invalidates
the corpus-scope analyses even though it invalidates nothing content-keyed.

### Cold equals warm

For every deterministic layer, a cold run and a fully warm run produce
byte-identical semantic output. The qualification suite asserts it on the
snapshot, the candidate projection and the readiness evidence together.

`embedding` is excluded from that promise, and is not enabled in this release. A
remote model is not a function this repository can make a claim about, so it is
cached and never called reproducible.

## What changed since last time

`corpus-diff.json` classifies every artifact against the previous snapshot:

`added`, `removed`, `changed_content`, `renamed_candidate`, `unchanged`,
`archive_added`, `archive_removed`, `archive_changed`.

A **rename candidate** is one content hash absent at an old corpus path and
present at a new one. Within a hash, departures and arrivals are each sorted and
zipped, so a hash with two departures and one arrival yields one rename candidate
and one removal, decided by code-point order rather than by iteration order.

It is a candidate because a move and an unrelated delete-here-create-there are
indistinguishable from two snapshots. It is not evidence that a person moved the
file, that the move was intentional, or that the two paths mean the same thing.

### Invalidation

```json
"invalidation": {
  "profile_changed": false,
  "new_content_hashes": ["sha256:…"],
  "retired_content_hashes": [],
  "retained_content_hash_count": 16,
  "content_keyed_layers": ["normalized_document", "interpretation", "lexical_features"],
  "corpus_scoped_layers_invalidated": ["candidate_analysis"],
  "cache_entries_removed": 0
}
```

Content-keyed layers are recomputed for new content hashes only. Corpus-scope
analyses depend on the whole document set, so any membership change retires them
— which is a real dependency, not a conservative approximation.

`cache_entries_removed` is always zero. An artifact that left the corpus may be
on the next disk the operator plugs in, and the work already done on those bytes
is still correct.

## Readiness evidence

Twelve signals, each carrying the exact thing that decided it and which kind of
evidence that was.

| Signal | Read from |
|---|---|
| `artifact.has_source_code` | a source extension |
| `artifact.has_tests` | a source extension plus a `tests/`-style segment or a `*_test`/`*.test` name |
| `artifact.has_build_manifest` | a build manifest filename or project-file extension |
| `artifact.has_ci_definition` | `.github/workflows/`, `.circleci/config.yml`, or a known CI filename |
| `artifact.has_container_definition` | `Dockerfile`, `compose.yml`, `Containerfile`, `.dockerfile` |
| `artifact.has_deployment_definition` | `Chart.yaml`, `fly.toml`, `Procfile`, `.tf`, `helm/values.yaml`, … |
| `artifact.has_specification` | `openapi.*`, `.proto`, `.graphql`, or `work.kind=specification` |
| `artifact.has_documentation` | a prose extension |
| `artifact.has_open_tasks` | `work.task.open` |
| `artifact.has_blockers` | `work.blocked_by` or `work.status=blocked` |
| `artifact.has_roadmap` | `work.kind=roadmap` |
| `artifact.has_plan` | `work.kind=plan` |

Evidence classes are `extension_convention`, `filename_convention`,
`path_convention` and `declared_assertion`, and they are never mixed. Following
[ADR-031](decisions/031-shared-manifest-filenames-are-not-package-manager-evidence.md),
a convention is evidence of the convention and of nothing behind it: `Makefile`
means a file named `Makefile` exists, not that the project builds.

`config/ci.yml` is not a CI definition. A workflow is one because of where it
sits, and a file named like one somewhere else is a file named like one.

### Bodies of work

A body of work is the member set of a project candidate. Its metrics are counts:

```text
source_file_count      test_file_count            manifest_count
ci_definition_count    container_definition_count deployment_definition_count
specification_count    documentation_count        open_task_count
completed_task_count   blocker_count              plan_count
roadmap_count          exact_duplicate_count      near_duplicate_count
candidate_version_count  supersession_declaration_count
unique_content_estimate  unique_content_bytes_estimate
```

`candidate_version_count` is the number of connected groups of size two or more
in the body's near-duplicate graph — how many clusters of lexically-close
variants exist, not which of them is newest or best.
`unique_content_estimate` is the count of distinct content hashes: exact
duplicates collapse to one.

No metric is combined with, weighted against, or projected from any other. A
consumer that wants a ratio can divide two of these and own what the result
means.

### What is refused

```text
build_priority   strategic_value   percent_complete
production_readiness_score         abandonment_probability
```

Named in `FORBIDDEN_READINESS_METRICS`, restated in every emitted document, and
asserted absent by a test that walks the whole document. Each requires a
judgement about worth, completion or intent that no count of files supports, and
a number like that rendered beside real counts inherits their authority without
having earned it.

## Candidates

Three classes, kept apart everywhere.

| | Exact duplicate | Near-duplicate | Topic candidate | Project candidate |
|---|---|---|---|---|
| Class | fact | candidate | candidate | candidate |
| Basis | content-hash equality | 5-shingle Jaccard | salient-vocabulary Jaccard | a container holding a marker |
| Means | the bytes are identical | the wording overlaps | the vocabulary overlaps | something declared a project here |

### Project candidates — `container-project-candidate/v1`

A container is a project candidate when it holds a **build manifest** or a **CI
definition**. A CI definition resolves to the directory holding its
`.github`/`.circleci`, not to the dot-directory.

The grouping key is the identifier the manifest **body** declared — `name` in
`package.json`, `module` in `go.mod`, `[project].name` or `[tool.poetry].name` in
`pyproject.toml`, `[package].name` in `Cargo.toml`, `<artifactId>` in `pom.xml` —
recorded with the line it was read from. Containers sharing a declared identifier
join into one candidate across roots and disks.

A container with no declared identifier keys on its own directory name, which
also crosses roots: `OldSSD::archive/widget` and `Backup::widget` join. A
root-level container with no declared name keys on its root and joins nothing,
because there is no name to join on that is not a mount point.

Members are assigned to the **innermost** container that claims them, so a
monorepo does not swallow its own packages.

### Topic candidates — `lexical-topic-candidate/v1`

1. take documents of at least 20 analysis tokens;
2. keep terms of at least three characters that are not in a closed stopword
   list and are not corpus boilerplate — a term in more than 80% of eligible
   documents, applied only once the corpus has at least five of them;
3. keep each document's 40 most frequent surviving terms;
4. score the Jaccard overlap of two documents' term sets;
5. join at `0.35` and report the connected components of size two or more.

Reached through an inverted index over salient terms, for the same reason the
near-duplicate pass uses one: two documents sharing no salient term score exactly
zero and cannot qualify at any positive threshold. At a threshold of *zero* every
pair qualifies by definition, including documents sharing no term at all, so that
case is answered directly — every eligible document in one candidate — rather than
through an index that could never reach it.

`shared_terms` lists the terms at least half the members carry.

**A topic candidate does not mean** the documents are about the same subject,
that they belong together, that one supersedes another, or that anything should
be merged. It means they use overlapping vocabulary. So do a deployment plan and
a deployment postmortem; so do two unrelated documents written by the same person
in the same month.

### The near-duplicate index

The pair generator was rewritten to an exact prefix-and-size filter:

- **size bound** — a set shares at most `min(|A|, |B|)` shingles, so a pair whose
  sizes differ by more than a factor of the threshold cannot qualify;
- **prefix bound** — shingles are put in one global order, rarest first, and only
  each document's first `|X| - ceil(t·|X|) + 1` shingles are indexed, because a
  qualifying pair must intersect there.

Both follow from the definition of Jaccard, and the generator is held to the
bounded all-pairs reference at seven thresholds and over a generated corpus with
shared boilerplate. Rarest-first matters for cost, not correctness: it puts the
shingles every document shares — a common heading, a licence block — at the end
of the order, where they are never indexed.

The previous all-pairs shingle index enumerated every pair sharing any shingle,
which on a ten-thousand-document corpus with a common heading exceeds the maximum
size of a JavaScript `Set`. That is a realistic corpus, not a synthetic one.

## Coverage

`corpus-coverage.json` reports what each analysis reached over what it was
eligible for, and separates *not supported* from *not present*.

```text
total_files                      total_bytes
archive_count                    archive_member_count
exact_hash_coverage              normalized_document_coverage
interpretation_coverage          lexical_analysis_coverage
embedding_coverage_when_enabled  unsupported_format_counts
ocr_required_count               encrypted_document_count
oversized_document_count         secret_skipped_count
project_candidate_count          topic_candidate_count
reasoning_eligible_candidate_count
```

- **unsupported formats** are text-bearing documents this release does not decode
  — `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.rtf`, `.odt`, `.epub` and the rest of a
  stated list — counted by extension with their bytes, so the gap is a number
  rather than an impression.
- **OCR required** is raster imagery, which carries no text layer for any decoder
  to read.
- **encrypted** is archive members held by the preflight.
- **oversized** is documents above the interpretation size limit.
- **secret skipped** is paths matching a credential pattern, which are never
  opened.
- **reasoning eligible** is a project candidate at least one of whose members
  decoded and at least one of whose members carries a readiness signal.

`embedding_coverage_when_enabled` is `null` and `embedding_enabled` is `false`.
No model is called and no network request is made by any code path in this layer.

### Reasoning handoff

```json
"reasoning_handoff": {
  "readiness_evidence_refs": { "schema": "…", "file": "readiness-evidence.json", "body_of_work_count": 20, "signal_vocabulary": ["…"] },
  "dependency_evidence_refs": [{ "predicate": "work.blocked_by", "assertion_count": 3 }],
  "duplicate_evidence_refs": { "exact_duplicate_cluster_count": 101, "near_duplicate_candidate_count": 0, "…": 0 },
  "unique_content_estimate": 10240,
  "no_priority_statement": "…"
}
```

References and counts. No priority, no ranking, no recommendation, and none can
be read out of the order of any list in it.

## Scale, interruption and atomicity

Concurrency and in-flight decoded bytes are bounded and configurable.
`max_parallel_decoders` and `max_memory_bytes` are enforced.
`max_parallel_hashers` is accepted and recorded but **not exercised**: acquisition
hashes each root with one streaming reader, and a value above one emits a
diagnostic saying so rather than implying a parallelism that does not exist.
`max_parallel_embedding_requests` is recorded; embeddings are not enabled.

`corpus-session.json` records completions by content-addressed key — source ids,
archive hashes, decoder keys, analysis keys — plus failure diagnostics. A
completion recorded by one attempt is still true for the next, and a completion
that has stopped being true simply produces a different key and is never
consulted. `--resume` adopts a manifest for the same root set; a manifest for
other roots, or one that cannot be read, is replaced rather than trusted.

The manifest names the work that was finished; **the cache holds what that work
produced**, and the two together are what make resumption real. Skipping a
document because the manifest says it was decoded, without the cached result,
would emit a corpus silently missing that document's assertions — worse than
redoing the work. `--resume --no-cache` is therefore refused rather than quietly
doing nothing.

Every projection is staged before any is moved, every target is checked before
anything is staged, and each target's previous contents are moved aside rather
than overwritten — so a failure part-way through the renames puts them back. A
projection this run did not produce leaves with the set: a `corpus-diff.json` from
an earlier run describes a comparison this run did not make, and nothing inside
the file says so, so `--no-diff` and a first run both remove it.

What that does **not** cover is the process being killed between two renames. No
userspace sequence of renames is atomic as a set, and claiming otherwise would be
a guarantee only discovered to be false during an incident.

## Nothing is executed, moved or judged

No build is run. No test in an observed project is executed. Nothing is
installed. No macro is executed. No file is moved, consolidated, deleted or
rewritten. No model is called. The source checksum before a scan equals the
checksum after it, warm or cold, and the CLI refuses to write its output, its
cache or its session manifest inside any observed root.

That refusal resolves symlinks first, on both sides. A lexical comparison approves
a symlink at `/tmp/out` pointing into an observed tree — it resolves to itself and
does not begin with the root — and every write then follows it straight through
the read-only guarantee. Dangling links are resolved too, because `--out` naming a
directory that does not exist *yet* inside an observed root is exactly the case
that matters.

## Still not in this release

Embeddings and vector search; PDF, DOCX, PPTX, XLSX or OCR extraction; image
understanding; `SAME_TOPIC` as an asserted edge rather than a candidate; project
naming; roadmap generation; consolidation or file-move plans; automatic keeper
selection; and any strategic priority, score or ranking.
