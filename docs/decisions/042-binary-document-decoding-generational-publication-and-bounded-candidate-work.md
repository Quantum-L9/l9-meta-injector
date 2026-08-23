# ADR-042: Documents are decoded, work is bounded, and evidence is bound to what it describes

## Status

Accepted. Closes the scope amendment recorded in
[ADR-040](040-semantic-candidate-discovery-and-reasoning-handoff.md), which
narrowed candidate discovery to text formats because no binary document decoder
existed. Extends
[ADR-036](036-read-only-local-source-acquisition.md) (read-only acquisition),
[ADR-038](038-multi-root-corpus-incremental-cache-and-readiness-evidence.md)
(multi-root corpora and the content-addressed cache),
[ADR-039](039-real-corpus-qualification-report.md) (measured qualification), and
[ADR-041](041-corpus-source-identity-verification-class-and-partial-corpora.md)
(split identities). None is superseded.

## Date

2026-08-23

## Context

Three prior pull requests each shipped less than the contract they answered, in
the same shape every time: the surface was there and the behaviour behind part of
it was not. An audit of the result named the specific instances.

**A decoder set that stopped at Markdown.** ADR-040 amended its own scope to text
formats. On a real archive that is a minority of the corpus — the plans, the
contracts, the decks, the spreadsheets and the scanned pages are `.docx`, `.pptx`,
`.xlsx` and `.pdf` — so the engine reported honestly about the part of a disk
that was already the easiest part to read, and counted the rest as an unsupported
format. Worse, the deficiency was invisible in the numbers: coverage said 100%,
because the denominator was "documents a decoder claimed".

**Fields that were never computed.** `candidate_added`, `candidate_removed` and
`candidate_changed` were the literals `0`, `0` and `0` on every diff, beside a
`comparable` flag. `secret_candidates_skipped` was tallied inside the decoded set
and a secret-candidate file is never decoded, so it was structurally always zero.
`embedding_coverage_when_enabled` was hard-coded `null`.

**Knobs that recorded an intention and acted on nothing.** `max_parallel_hashers`
and `max_parallel_analysis` were parsed, written into the session manifest, and
exercised nowhere. `max_parallel_decoders` was exercised, but every decoder read
its own file synchronously, so in a single-threaded runtime it bounded nothing an
operator would set a flag for.

**A qualification that avoided its own hard case.** The ten-thousand-artifact
scale run had topic candidates switched off, with a note calling the pass a
worst-case quadratic. The note was correct. Switching the pass off meant the
scale qualification measured a scan the release does not perform.

**Guarantees stated in comments.** The output commit renamed projections into
place one by one and said in its own comment that no userspace sequence of
renames is atomic as a set. The topology conformance harness said the consumer
checkout was read-only while spawning an interpreter over it. The cache and the
session manifest staged and renamed without syncing either. `VALIDATION_REPORT.md`
recorded a green gate over a suite less than half the current size and was bound
to nothing.

## Decision

### Seven decoders, no new runtime dependency

`src/documents/` decodes PDF, DOCX, PPTX, XLSX, IPYNB, CSV and HTML into the
existing `NormalizedDocument`. Nothing was added to `dependencies`: OOXML is a
ZIP of XML parts and this repository already has a hardened ZIP reader, and PDF's
FlateDecode is Node's own `zlib`. That is not thrift. The bounds this package has
to enforce — entry counts, compression ratios, part-size ceilings, path
containment, refusal to fetch an external relationship — are properties of the
reader, and a third-party parser would have to be audited for every one of them
before it could be trusted with an operator's private archive.

Each block carries its own format's coordinate: a page and an index for a PDF, a
slide and a shape for a deck, a sheet and a cell reference for a spreadsheet, a
cell index for a notebook, a node path for HTML, a line span for text. **No format
that has no lines is given a line number.** The binary-locator prerequisite
ADR-040 dropped is met by construction rather than approximated.

A refusal is a typed reason and never an empty document. A scanned PDF reports
`decoder.ocr_required`; an encrypted container reports `decoder.encrypted`. Those
are different findings from each other and from a corrupt file, and merging them
would hide which.

The read-only invariant extends to every new format. No notebook cell is
executed — the decoder reads `source` and never `outputs`. No spreadsheet formula
is evaluated; a formula is rendered with its last saved value. No Office macro is
executed; macro parts are noted as present. No HTML script is executed; opaque
element contents are dropped rather than indexed. No external reference is
fetched; links and external relationships are recorded as declared.

### Decoded text participates in the analysis, and the report says whether it did

Lexical analysis was gated on a four-extension list. A decoded `.docx` would have
been counted in coverage and reached no candidate at all — a decoder wired to
nothing, and invisible in every number.

Prose document formats now enter lexical analysis on **format** rather than
extension. Text and Markdown keep the extension gate, because that decoder also
claims `.ts` and `.py`, and shingling a repository's TypeScript would report every
file sharing an import block as a near-duplicate of every other.

`document-signals.json` (`l9.corpus-document-signals/v1`) reports, per format,
what was decoded, what refused it and why, which locator kinds it cited, and —
the point — how many of its documents were analyzed and named by a candidate.
"Eleven PDFs decoded, zero in any candidate" is a real failure and is invisible in
a coverage ratio.

Interpretation stays extension-gated, and this is a decision rather than an
omission: the work-signal extractors cite line spans, and running them over a
Word document's joined block text would produce exactly the fabricated line
numbers this package refuses to emit. Binary formats therefore report
`interpreted_count: 0` per format, stated rather than absent.

### Coverage reconciles rather than totals

`decode_gap` accounts for every eligible document that did not become a
normalized one — refused for its name, oversized, not text, no text layer,
encrypted, malformed, some other stated refusal — and carries an `unaccounted`
residual so a document lost by an unnamed route surfaces instead of disappearing
into the difference between two numbers.

The unsupported-format and OCR-required lists are now the decoder registry's
complement rather than a parallel opinion about it, and a registry that claims an
extension the gap list also claims fails the run.

### An embedding provider that runs

`http-json` POSTs `{model, input}` and reads a vector back, accepting the four
response shapes real model servers emit. The containment rules from ADR-040 are
mechanism here rather than prose: a `local` provider must name a loopback
literal — no name resolution, because a guarantee that depends on a DNS answer is
not one — redirects are errors and never followed, a bearer comes from the
environment and is refused over cleartext, and responses are read under a hard
byte cap.

The pass runs inside the scan, because the text it sends is the *normalized*
text, which does not exist until the decoders have run. "The operator implements
the interface" could never have worked from outside for that reason.

### Candidate deltas are computed or declared uncomputable

A snapshot carries an `analysis_manifest`: for every candidate, an id, a kind and
a hash over what the candidate claims. Two manifests diff exactly, broken out per
kind. When either snapshot has no manifest — one written by an earlier release,
or two manifests at incompatible versions — all four counts are `null` with a
stated reason.

Zeros now occur only when two manifests were compared and matched. Three zeros in
fields a reader takes as measurements are worse than three absent fields, because
they read as "nothing changed" to anyone who does not check a flag first.

### A budget is a bound the run is held to, or it is deleted

`max_parallel_hashers` and `max_parallel_analysis` are removed from the budget
type, the defaults and the CLI, and an invocation still passing one is refused by
name with the reason rather than ignored. Silently dropping a retired flag is how
a decorative knob survives its own removal.

Neither is a gap awaiting a larger number. Acquisition hashes a root with one
synchronous streaming reader, which is what makes its did-this-tree-move check
meaningful, and candidate generation is a single pass over evidence already in
memory. Parallelising either is a redesign of that layer, not a budget.

`max_parallel_decoders` is made real: whole-file formats are read with
`fs.promises` and the bytes handed to the decoder, so N reads are genuinely in
flight and each document is read once instead of twice. Container formats are
excluded, because their readers stream parts out by offset and buffering a whole
spreadsheet to hand it over would trade the concurrency for a memory spike.

Concurrency is measured at the read seam. Instrumenting `decode` would report 1 at
every budget, because a synchronous call cannot overlap another.

### Topic candidates are bounded by an exact filter, not by being switched off

The topic index held every salient term of every document, so a term appearing in
four thousand documents produced eight million pairs from one posting list. The
cost was quadratic in the corpus, arriving inside the index rather than around it.

It now holds each document's **rarest-first prefix**, under the same two exact
bounds the near-duplicate pass has always used: a prefix bound (a pair sharing
`ceil(t·|X|)` terms must both hold one of the first `|X| − ceil(t·|X|) + 1` in any
fixed order) and a size bound. Rarest-first is what makes the prefix bound pay —
the vocabulary a corpus shares sorts to the end and is never indexed.

Neither is a sample. `buildTopicCandidatesExhaustive` is exported as the reference
and the two are held to exact agreement at six thresholds across four corpus
shapes.

Every pass reports its pair work in `corpus-coverage.json`. At ten thousand
artifacts with the pass enabled: 9,740 eligible documents, 47,428,930 pairs if
everything were compared, **9,733 Jaccard computations actually run**.

### A whole output set appears at once, or not at all

Outputs go into `generations/<content-hash>/`, and a single durable rename of
`CURRENT.json` makes the set visible. A reader's view changes from all of the
previous run to all of this one at one instant. Files are synced before the
directories that name them, the directories before the pointer; pruning happens
after the switch and never touches what the pointer names.

`commitCorpusOutputs` is removed rather than left beside its replacement.

### Writes are durable, not merely atomic

`src/durable_write.ts` does write, fsync the file, rename, fsync the parent. A
rename is atomic against this process dying and says nothing about a power cut,
because both the bytes and the directory entry naming them can still be in the
page cache — and a file of the right length full of zeros parses. The cache and
the session manifest both route through it. A torn `completed_source_ids` that
still parses would make the next attempt skip work that was never done, which is
precisely the failure a resume feature must not have.

### A root id says how much it is worth

`root_identity_class` is `declared` when the operator named the root and
`inferred` when its basename was taken. `/Volumes/Backup` and an unrelated
`/mnt/usb/Backup` key identically, so a diff reporting `root_unchanged` between
two runs may be comparing two different drives. Each root diff row states the
basis its continuity claim rests on, and a match not made between two declared
keys produces a caution naming the root and the remedy. A snapshot predating the
class reads as `inferred`: assuming `declared` would manufacture a guarantee out
of a missing field.

### Evidence is bound to what it describes

A real archive is scanned when an operator names one in
`L9_ACCEPTANCE_CORPUS_MANIFEST` — a declaration, never a search. Nothing
enumerates drives or guesses at locations, and a test asserts there is no
fallback path on every machine, including the ones where the variable is unset.

The topology conformance harness digests the consumer checkout before and after
its probe and fails if anything moved. The recorded evidence gains a binding to
the exact bytes of every file in each golden bundle. The checkout digests are
deliberately *not* written into the committed record: they are a property of one
machine's working tree, and a verification record carrying a field nobody else can
reproduce is evidence that looks stronger than it is.

`VALIDATION_REPORT.md` is replaced by a generated `CURRENT_VALIDATION_REPORT.md`
bound to a digest of the tree the gate ran over — over the tree content rather
than the commit id, because a report bound to HEAD is invalidated by the commit
that carries it, and a check nobody can satisfy is a check everyone learns to
skip.

## Consequences

- An operator pointing this at an archive of Word documents and PDFs now gets
  duplicate clusters, near-duplicates, topics and projects across them, rather
  than a coverage report explaining that most of the disk was unreadable.
- `TOPIC_CANDIDATE_METHOD_VERSION` moves to `1.1.0`. The bound is exact so the
  candidates are the same ones, but the method that found them is not, and an
  analysis identity that did not move would claim two algorithms were one. Topic
  candidate ids therefore change, and a diff across the version boundary reports
  that honestly rather than hiding it.
- Output consumers must resolve `CURRENT.json`. Nothing sits at a fixed path in
  the output root any more, which is the price of the set-atomicity guarantee.
- `--max-hash-workers` and `--max-analysis-workers` are errors. An invocation
  using them fails with the reason instead of proceeding under a setting it was
  never subject to.
- Legacy containers (`.doc`, `.xls`, `.ppt`, `.odt`, `.epub`, `.pages`, `.rtf`)
  remain unopened, and are counted explicitly with their byte totals so the gap
  is a number an operator can read rather than an absence they have to notice.
- OCR is still not performed and still not pretended.

## Alternatives considered

**Add a PDF and OOXML library.** Rejected. The package's zero-dependency runtime
is a property consumers inherit, and every bound this layer must enforce would
have to be re-established through somebody else's parser before an operator's
private archive could be handed to it.

**Keep `commitCorpusOutputs` and document its limit.** Rejected. The limit is the
failure: a coverage report from one run beside a readiness document from another,
both parsing, with nothing in either saying which run it came from.

**Cap the topic pass's pair work with a stated budget.** Rejected in favour of the
exact prefix bound. A budget truncates and has to be reported as truncation; the
prefix bound loses no qualifying pair, so there is nothing to report.

**Bind the validation report to HEAD.** Rejected: the commit that carries the
report invalidates it, and every workaround for that either stops committing the
report or excuses the exact case the binding exists to catch.
