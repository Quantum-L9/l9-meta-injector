# ADR-059: Corpus cache epoch v2 and decoder-dialect identity

## Status

Accepted

## Date

2026-10-28

## Context

Amends [ADR-038](038-multi-root-corpus-incremental-cache-and-readiness-evidence.md)
(content-addressed cache: "a cache is allowed to be empty; it is not allowed to be
wrong") and
[ADR-042](042-binary-document-decoding-generational-publication-and-bounded-candidate-work.md)
(normalized document identity is bound to the exact bytes and to the decoder that read
them). The remediation plan for `bf66978` found four ways in which the cache, or the
identity it is keyed on, could be wrong. All four were reproduced by audit probes.

- **RC-062 (F-008).** `deriveDocumentLayers` in `src/corpus_scan.ts` filed every
  derived layer (normalized document, lexical features, interpretation, declared
  identifier) under keys computed from the step-1 acquisition hash. It derived those
  layers from a second read of the path, and for text formats from a third read
  (`probeFileEncoding`). Nothing compared what it read with that hash. A file edited
  between hashing and decoding was decoded from its new bytes and cached permanently as
  the decoding of its old bytes. The run then reported `hash(v1)` beside evidence quoted
  from v2.
- **RC-064 (F-060).** The text-family encoding probe ran on the path, and its
  `unreadable` status was cached under the content key. That status describes the
  filesystem at one moment, not the bytes. Every later run, and every other path holding
  the same bytes, then skipped decoding. No I/O-failure route named the file.
- **RC-067 (F-009).** The text decoder chooses Markdown or plain text from the source
  extension, and the CSV decoder chooses its delimiter (comma, or tab for `.tsv`) the
  same way. Neither the `normalized_document` key nor the normalized document identity
  included the extension. Identical bytes at `a.md` and `b.txt`, or at `c.csv` and
  `d.tsv`, therefore shared one cache entry and one `normalized_document_id`. Whichever
  file decoded first decided both.
- **RC-068 / RC-071 (F-061, F-124, F-125).** The near-duplicate `candidate_analysis`
  key left out the exact content hashes that decide pair eligibility. The indexed
  candidate generators also bounded the threshold with floating-point products whose
  precision differed from the qualifying test and from the cache key. These are
  non-blocking decisions of the same batch and are recorded here.

The entries that RC-062 and RC-064 poisoned live under keys the fix does not change.
Correcting the code therefore does not retire them.

## Options Considered

### DEC-RC-062: an artifact whose bytes no longer match at derive time

#### Option A: per-file refusal for this run

The artifact keeps its step-1 hash and gets no derived evidence. An in-run refusal reason
is recorded but not cached, a diagnostic names the corpus path, and the run continues.

- Pros: the snapshot stays truthful, because the hash describes what was observed.
  Coverage shows the gap. Long scans of live disks gain no new failure mode.
- Cons: one more undecoded reason for consumers to recognise.

#### Option B: mark the whole root unstable

This mirrors acquisition's `SOURCE_CHANGED_DURING_OBSERVATION`.

- Pros: strictest, and consistent with acquisition stability.
- Cons: one edited file on a live drive discards a whole root's results late in a long
  run.

#### Option C: re-derive identity from the new bytes

- Cons: violates "step 1 decides identity". Rejected.

### DEC-RC-067: how a path-dependent decoder dialect enters key and identity

#### Option A: decoder-declared dialect in key and identity, only when present

- Pros: `decoder_id` and `format` are unchanged. Ids move only where a dialect exists
  (and through the version bump). The dialect decision stays inside the decoder.
- Cons: a small internal interface addition on `DocumentDecoder`.

#### Option B: split into separately registered Markdown and TSV decoders

- Cons: `decoder_id` values change for `.md`/`.tsv`. Registry composition changes
  (ADR-042's decoder set). The `by_format` tally would need a new `DocumentFormat`.

#### Option C: dialect in the cache key only

- Cons: the cache stops lying, but two different decoded documents still share one
  published `normalized_document_id` and one block-id namespace.

### DEC-GAR-05: cache and identity epoch policy

- Option A: one `CORPUS_CACHE_ENTRY_SCHEMA` bump for the batch, plus per-decoder and
  per-profile version bumps where a decoder's output changes.
- Option B: a version field on every layer key.

### DEC-RC-071: how the topic comparison treats a canonicalised threshold

- Option A: compare the raw Jaccard `J >= t6`, where `t6 = round6(t)`.
- Option B: compare `round6(J) >= t6`, as near-duplicates do. This changes results at
  six-decimal thresholds near small-denominator rationals and needs a method version
  bump.

## Decision

The repository owner adopted the recommended option of every decision.

1. **DEC-RC-062, Option A.** The derive stage verifies before it derives:
   - A whole-file format (including the text family) is read once. That buffer is
     SHA-256-hashed and compared with `artifact.contentHash`, and the same buffer is
     probed (`probeBufferEncoding`) and decoded.
   - A container format (`docx`, `pptx`, `xlsx`) is hashed with `hashFileStreaming`
     immediately before its decode. Its size and nanosecond mtime must be unchanged
     across the decode.
   - On a mismatch nothing is cached for the artifact, and the in-run record is
     `decodes: false` with reason `changed_during_scan`. A warning diagnostic
     `corpus.document_changed_during_scan` names the corpus path. A document record
     already served from the cache under the same key is kept, because it was derived
     from verified bytes.
2. **RC-064 (delivered with DEC-RC-062).** Only byte-determined outcomes are cached:
   binary, invalid UTF-8, and decoder refusals of verified bytes. Every I/O-failure
   route records reason `unreadable` for this run only and emits a warning diagnostic
   `corpus.document_unreadable` with the corpus path. The next run retries.
3. **DEC-GAR-05, Option A.** The cache epoch moves once, to
   `CORPUS_CACHE_ENTRY_SCHEMA = "l9.corpus-cache-entry/v2"`. `FileCorpusCache.get` and
   `MemoryCorpusCache.get` treat an entry of the previous epoch as a stale miss: counted
   under `stale_producer`, discarded, no diagnostic. The corrupt-entry path, which would
   warn once per entry, is not used for it. Decoder-version bumps cover decoders whose
   output identity changes.
4. **DEC-RC-067, Option A.** `DocumentDecoder` gains an optional dialect resolver. The
   text decoder declares `markdown` for `.md`/`.markdown`/`.mdx`, and the CSV decoder
   declares `tsv` for `.tsv`. Both decoders branch on that resolver and no longer test
   the extension themselves. `normalizedDocumentKey` and `normalizedDocumentId` take an
   optional `dialect` that is hashed only when present, so no other decoder's id moves.
   `TEXT_DECODER_VERSION` and `CSV_DECODER_VERSION` are bumped so dialect-less entries
   are never served, and the analysis identity records the change.
5. **DEC-RC-071, Option A.** The topic threshold is canonicalised once
   (`t6 = round6(t)`) and compared as raw `J >= t6`. The bounds, candidate ids, profile
   hash and cache-key suffixes all derive from that same `t6`. The near-duplicate bounds
   are computed in exact integer arithmetic on micro-units, from the half-unit-lowered
   threshold, so they are never stricter than the qualifying test `round6(J) >= t6`. The
   near-duplicate `candidate_analysis` key includes each document's exact content hash
   (RC-068).

## Consequences

- **Cache.** The first run after upgrade misses every entry once and reports it as
  stale, not corrupt. A package version change already discarded entries through
  `producer_version`. The epoch covers same-version and library callers.
- **Output for stable corpora.** Cold and warm stay byte-identical. A file that changes
  mid-scan or cannot be read appears in `document-index.json` with `undecoded_reason`
  `changed_during_scan` or `unreadable`, and is counted in `decode_gap.other_refusal`.
  `decode_gap.unaccounted` stays 0. `corpus-coverage.json` has no schema change.
- **Diagnostics.** Two new per-file warning codes: `corpus.document_changed_during_scan`
  and `corpus.document_unreadable`.
- **Identity.** `normalized_document_id` moves once for Markdown and TSV documents
  (dialect), and for every text and CSV document (version bump). `decoder_version`
  strings change, and with them `corpus_analysis_id`. `decoder_id` and `format` are
  unchanged. Consumers joining across releases on `normalized_document_id` see the move
  attributed by the changed analysis id.
- **Candidates.** Thresholds with at most six decimals produce unchanged results, except
  that near-duplicate pairs exactly at the threshold, which the indexed pass used to
  drop, are now reported. A topic threshold with more decimals behaves as its six-decimal
  rounding, which its identity already claimed. The first run after upgrade misses the
  near-duplicate analysis once.
- **Residual.** For container formats, unchanged size and mtime across the decode is
  evidence that the bytes held still, not proof. This is the same standard acquisition's
  `hashStableFile` applies.
- **No public API change.** `corpus_scan`, `corpus_cache` and the decoder internals are
  not entrypoints in `docs/public-api-contract.json`.
