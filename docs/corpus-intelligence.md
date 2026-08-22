# Corpus intelligence

Authority: [ADR-037](decisions/037-artifact-scoped-evidence-and-corpus-intelligence.md).
Builds on read-only acquisition, [ADR-036](decisions/036-read-only-local-source-acquisition.md).

Point a corpus at a folder, a drive, or a ZIP and you get back evidence about
each document: what it declares about its own work, which documents are the same
file, and which pairs share enough wording to be worth a look.

```bash
npm run local-source -- /Volumes/Archive/old-projects --name old-projects --out ./out
```

```
out/
  bundle/                      Repository Model Packet, manifest, validation receipt
  local-source-manifest.json   acquisition manifest
  corpus-index.json            l9.corpus-index/v1
  corpus-report.md             the same projection, for a person
```

Nothing under the source is written, renamed, or removed. No file is moved,
deleted, or consolidated — not by default, and not by any flag this layer has.

## What is a fact and what is a candidate

The layer is built around one distinction, and the wording of the output
protects it.

| | Basis | Epistemic class | What you may conclude |
|---|---|---|---|
| **Exact duplicate** | equal content hashes | fact | these files have identical bytes |
| **Near-duplicate** | lexical similarity ≥ threshold | candidate | these two share wording; go look |
| **Work signal** | an explicit declaration, with its line | source-declared | this document says this about itself |

An exact duplicate can be acted on mechanically. A near-duplicate is a question
for a reader. Reporting a 0.9 similarity score as a "duplicate" would turn a
lexical measurement into a deletion recommendation nobody made, so the report
never does.

## Artifact-scoped vs repository-scoped assertions

An extractor declares whose claim it is producing:

```ts
export const workIntelligenceExtractor: Extractor = {
  id: "work-intelligence/v1",
  subjectScope: "artifact",   // this document's status, not the corpus's
  // ...
};
```

`repository` is the default and the historical behavior. A rule that reads
`README.md` to learn a repository's declared status speaks for the repository.
A rule that reads a plan's `Status: WIP` speaks for that plan — attaching it to
the repository would say the whole corpus is WIP.

For an archive member the subject is the member's own artifact:

```
archive-a.zip!/inner.zip!/draft.md   ->   artifact:<hash of that virtual path>
```

not the outer archive, not the containing archive, and not the source root.

Both scopes coexist in one packet. Producer validation requires every assertion
subject to resolve to a repository or an artifact the packet carries; anything
else fails as an orphan. The packet version stays `1.1.0` — no field changed
shape — and the bound topology consumer accepts both scopes with no translation
shim.

## Work intelligence is reading, never inference

Every predicate requires an explicit declaration site, and every assertion cites
the exact line.

| Predicate | Read from |
|---|---|
| `document.title` | frontmatter `title`, Markdown H1, or a `Title:` line |
| `document.heading` | each Markdown ATX heading, as `H<level>: <text>` |
| `work.status` | frontmatter `status`, a `Status:`/`State:` label, a leading admonition, or a title marker like `[WIP]` |
| `work.kind` | frontmatter `type`/`kind`, or a title that names the kind |
| `work.task.open` | an unchecked checkbox, or a line starting `TODO:` |
| `work.task.completed` | a checked checkbox |
| `work.milestone` | a `Milestone:` label, or a bullet under a `Milestones` heading |
| `work.depends_on` | `Depends on:`, `Depends upon:`, `Requires:` |
| `work.blocked_by` | `Blocked by:` |
| `work.references` | `Reference:`, `References:`, `See also:`, `Related:` |
| `work.supersedes` | `Supersedes:`, `Replaces:` |
| `work.superseded_by` | `Superseded by:`, `Replaced by:` |

Status vocabulary: `wip`, `draft`, `planned`, `blocked`, `paused`, `active`,
`done`, `complete`, `archived`, `superseded`, `cancelled`.
Kind vocabulary: `plan`, `roadmap`, `proposal`, `design`, `specification`,
`notes`, `checklist`, `decision`, `research`.

What is never done:

- No status from a file's age, path, TODO count, or lack of open tasks.
- No kind from the theme of the body. `# Deployment Roadmap` names a roadmap;
  a document that merely discusses roadmaps does not.
- No task from the word "todo" inside a sentence.
- No reading inside fenced code, so documented syntax is not a declaration.
- No resolution of a declared target by fuzzy filename match. The object is the
  string the document wrote.

Contradictions survive. A document saying both `Status: WIP` and
`Status: Complete` emits both, each citing its own line.

Inputs are `.md`, `.markdown`, `.txt`, `.rst` that are valid UTF-8, within the
interpretation size limit, and not on a secret-candidate path. PDF, DOCX, PPTX,
XLSX, images, OCR, and notebooks are out of scope.

## Exact duplicates

Two artifacts are duplicates when both have a content hash and the hashes match.
Clustering runs over the unified record set, so all of these land together:

- two copies in different folders
- a physical file and a member inside a ZIP
- two members of different archives
- a member of a nested archive and a physical file

`corpus-index.json` renders one `DUPLICATE_OF` relation per non-representative
member, pointing at the cluster's representative, with `duplicate_cluster_id` and
`symmetric: true` on every edge. That is a star for rendering, not a claim of
direction: an *n*-member cluster produces *n−1* edges instead of *n(n−1)/2*, and
the cluster ID says the equivalence is cluster-wide.

**The representative is not a keeper recommendation.** It is chosen by shortest
path, then code point, purely so rendering is deterministic. Which copy to keep
depends on things this layer cannot see.

`DUPLICATE_OF` is deliberately **not** in `RepositoryModelEdgeType`. The bound
topology contract does not own a duplicate edge yet, and repurposing
`DERIVED_FROM` or `MEMBER_OF` to mean "duplicate" would corrupt a vocabulary two
repositories share.

## Near-duplicate candidates

`text-near-duplicate/v1`:

1. Normalize: NFKC, CRLF/CR → LF, lowercase, collapse whitespace, trim.
2. Tokenize into Unicode word tokens.
3. Take unique 5-token shingles.
4. Score exact Jaccard over the two shingle sets.
5. Report pairs scoring above zero and at or above the threshold (default 0.85).

Documents under 20 tokens are skipped: a score over a handful of tokens says
more about the corpus's boilerplate than about the documents.

```bash
npm run local-source -- ./corpus --near-duplicate-threshold 0.7
npm run local-source -- ./corpus --no-near-duplicates    # exact duplicates still report
```

The threshold participates in the analysis identity, so the same corpus scored at
0.85 and at 0.6 is the same evidence under two different questions.

**Exact duplicates never appear as candidates** — they are already the stronger
fact. But a file that *has* an exact twin is still compared against everything
else; one representative per cluster is analysed, so a real finding is never
dropped and a cluster of copies does not restate the same candidate *n* times.

Candidate generation uses a shingle index: only pairs sharing at least one
shingle are scored, and each surviving pair is then scored by the same exact
function the definition uses. The suite asserts this returns exactly what a
bounded all-pairs reference returns, at several thresholds — it skips pairs that
cannot qualify, it does not approximate.

A candidate never means same topic, same project, supersession, redundancy, or
that anything should be merged or deleted.

## The corpus index is a projection

`corpus-index.json` and `corpus-report.md` derive entirely from the acquisition
observation, the emitted packet, and the two analyses above. They read no source
files and introduce no facts, so the index cannot disagree with the packet it
cites.

Every artifact ID resolves to a packet artifact; every work signal's assertion ID
resolves to a packet assertion; every duplicate and candidate endpoint resolves to
an artifact in the index. Scratch paths never appear. Serialization is canonical:
code-point key order, no wall clock, byte-identical across runs of the same
inputs under the same profile.

The corpus index has its own canonical serializer. The packet's is integer-only —
the wire contract forbids floats so two runtimes cannot disagree about a decimal —
and a similarity score is genuinely fractional, so the corpus form carries floats
at fixed precision rather than loosening the wire rule.

## Identity

| Change | Effect |
|---|---|
| replay, same inputs and profile | everything identical, byte for byte |
| corpus moved to another absolute path | all semantic IDs unchanged |
| different scratch location | all semantic IDs unchanged |
| one task line edited | that document's content hash and assertion change; unrelated clusters and candidates unchanged |
| a file renamed | source revision and that artifact's ID change; its content-based duplicate cluster does not |
| threshold changed | packet semantic hash unchanged; corpus analysis identity changes; the candidate set may change |

## Not in v1

Topic clustering, embeddings, vector storage, LLM summarization or
classification, `SAME_TOPIC` edges, project grouping or naming, roadmap
generation, build prioritization, consolidation recommendations, automatic keeper
selection, file moves, file deletion, and extraction from PDF, DOCX, PPTX, XLSX,
images or OCR.

The point of stopping here is that the next layer — whatever groups related work
and weighs consolidation — needs a substrate it can trust. Evidence with a cited
line is that substrate. A guess wearing the same shape is not.
