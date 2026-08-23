# ADR-039: A measured run over a mixed read-only corpus is a first-class artifact

## Status

Accepted. Extends [ADR-038](038-multi-root-corpus-incremental-cache-and-readiness-evidence.md)
(multi-root corpora, content-addressed reuse, readiness evidence). Nothing is
superseded: ADR-038 still describes what the corpus layer computes, and this
decision only adds a way to say what it computed on a corpus that was not
designed to make it look good.

## Date

2026-08-23

## Context

ADR-038 landed the corpus layer with two kinds of test behind it, and both are
property tests. `corpus_qualification.test.ts` asserts the invariants — cold
equals warm, a change invalidates only what depends on it, an interrupted scan
resumes, a corrupt cache entry is discarded. `corpus_scale.test.ts` asserts the
same invariants still hold at ten thousand artifacts. Both build their corpora
from constants, which is the right way to test a property: when the assertion
fails there is exactly one thing it can be about.

What neither of them produces is a *measurement*. An operator deciding whether
to point this at a disk they care about is not asking "are the invariants
sound". They are asking what fraction of a real, mixed, untidy archive the
decoders can actually open, how much of it is invisible, and whether the second
run is cheap enough to be worth doing. Those are numbers, they depend entirely on
what the corpus contains, and a property test is structurally the wrong shape to
report them: it is written to be insensitive to exactly the details that decide
the answer.

The gap showed up as a concrete absence. Every number a reader could have quoted
about this engine came from a corpus built to demonstrate a property, and the
repository contained no run over anything else.

## Decision

Add a third qualification alongside the property and scale suites: a **measured
run over a deliberately mixed, read-only, two-root corpus**, whose output is a
schema'd report rather than a set of assertions.

1. **`l9.corpus-qualification-report/v1`** (`src/corpus_qualification.ts`) is
   built from a cold run and the warm run that followed it. It carries files and
   bytes scanned, the second run's own cache hit ratio, decoder coverage,
   duplicate counts, topic and project candidate counts, the reasoning-eligible
   count, and everything the run could not read, split by *why* it could not.

2. **The measurements come from the cold run; the cache ratio comes from the warm
   one.** Each number is a fact about the run it is a fact about. The two are not
   averaged, and the warm run measured is the second warm run, so its ratio
   describes a cache that was already complete when it started.

3. **The fixture is mixed on purpose.** Five archives including a nested one,
   documents in two dozen extensions, four project shapes with real build
   manifests, exact duplicates that cross the root boundary, two revisions of one
   plan — one that clears the similarity threshold and one that correctly does
   not — and three credential-shaped files, two of them in formats the decoders
   would otherwise open.

4. **The report inherits both existing boundaries.** No absolute path appears in
   it, because a mount point is not part of what is reported about a corpus. No
   number in it ranks anything, and the same forbidden-metric test that guards
   readiness evidence guards this report.

5. **The qualification and its evidence are one execution.**
   `scripts/corpus-qualification.js` (`npm run qualify:corpus`) runs the test file
   and writes the report the passing run produced. A report on disk is therefore
   never from a run that did not pass.

## Consequences

The repository can now state what this engine does on a corpus rather than only
what it guarantees about one, and the statement is reproducible by anyone with a
checkout.

Two fields are environment-dependent by construction and are documented as such
rather than asserted. `read_only_enforced_for_process` is false when the run is
root, because root writes through `0o444`; the tree digests include mode bits and
so differ between environments. Neither is a pass criterion. The pass criterion
is `mutated_path_count: 0`, which holds either way, and which compares content
*and* mode for every path — a scan that left the bytes alone but relaxed a
permission bit has still modified the source.

The report is deliberately not gate-checked against a committed golden copy. A
golden report would pin exactly the environment-dependent fields above and would
turn an evidence artifact into a source of false failures.

The measurement assertions are floors and relationships rather than literals, so
the fixture can grow without the test becoming a test of the fixture. The
relationships pinned are the ones that would break if something silently went
wrong: the decode shortfall equals the secret-skipped count, cold and warm render
identically, and the coverage projection agrees with the report that quotes it.

## Alternatives considered

**Extend `corpus_qualification.test.ts`.** Rejected: it would mix a suite whose
assertions must be insensitive to corpus content with one whose whole purpose is
to be sensitive to it, and the two would erode each other.

**Commit the fixture as a tree.** Rejected: ZIP archives committed as binary
cannot be read or reviewed, and the repository's existing convention writes
corpora from constants so that every hash derived from them is stated in one
readable place.

**Report a single "source is read-only" boolean.** Rejected as a claim the
implementation cannot support under root. The report states what was applied and
what was enforced separately, and proves non-mutation by digest.
