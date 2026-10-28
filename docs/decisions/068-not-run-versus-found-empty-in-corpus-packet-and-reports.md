# ADR-068: Not-run versus found-empty in the corpus-intelligence packet and coverage/qualification reports

## Status

Accepted. Amends [ADR-039](039-real-corpus-qualification-report.md) (the
qualification report's `decoder_coverage` and extension count) and
[ADR-041](041-corpus-source-identity-verification-class-and-partial-corpora.md) (what
the corpus coverage and packet may claim about passes a run did not make); both
decisions otherwise stand.

## Date

2026-10-28

## Context

The repository already treats "a pass did not run" and "a pass ran and found nothing"
as different facts. `src/corpus_intelligence.ts` says of `CORPUS_PAYLOAD_FIELDS` that an
empty array "means the producer found nothing of that kind, which is a different
statement from a domain that was never run"; `src/corpus_report.ts` prints "did not
run" separately from "found none"; `docs/corpus-scale-operation.md` says embeddings
"report as disabled rather than being omitted — those are different facts", and
`embedding_coverage_when_enabled` is `null` when embeddings are off. Four projections
broke that rule.

**RC-076 (F-064).** The `l9.corpus-intelligence` packet had no way to say a domain was
not run. With `--no-semantic-analysis`, `corpusIntelligenceInput`
(`src/corpus_intelligence_input.ts`) emitted `topic_candidates`,
`consolidation_candidates`, `semantic_pair_relations`, `reasoning_candidates` and
`reasoning_evidence_pack_refs` as empty arrays with `validation.status: "passed"`, and
the lexical topic candidates the run had computed (`result.candidates.topic_candidates`)
never crossed the boundary, although the lexical project candidates did. Reproduced on
the cross-root fixture: `corpus-candidates.json` 1 topic candidate, packet
`topic-candidates.json` 0.

**RC-086 (F-069).** `runCorpusScan` (`src/corpus_scan.ts`) filtered interpretation
eligibility by `interpretEnabled`, so `--no-interpret` produced an empty eligible set and
`coverageRatio`'s "nothing eligible = complete" convention reported
`interpretation_coverage {eligible: 0, covered: 0, ratio: 1}`. `CorpusCoverage` and the
qualification report's `DecoderCoverage` had no flag, so a disabled pass read as a fully
covered corpus; the CLI printed `interpreted 0/0`.

**RC-088 (F-135).** `buildCorpusQualificationReport` (`src/corpus_qualification.ts`)
filled `decoder_coverage.text_decoder_id/text_decoder_version` from corpus_scan's legacy
`TEXT_DECODER_ID`/`TEXT_DECODER_VERSION` (`utf8-text-decoder@1.0.0`), a decoder that is
not in the registry, as the identity behind ratios that span every registered decoder.

**RC-089 (F-136).** The same report derived `distinct_extension_count` from the
label-prefixed `corpus_path`, so a root label containing `.` turned extensionless
root-level files into extensions (`Backup2019` → 1, `Backup.2019` → 4 over identical
files).

## Options Considered

### DEC-RC-076: how the packet expresses a payload domain that was not run

1. **Additive per-domain run statement and a packet minor version bump** — explicit,
   hash-bound, validator-checkable; the consumer must admit the new version and key.
2. **Refuse to emit the packet when semantic analysis is off** — no schema change, but
   such runs lose their project, readiness and duplicate domains from the canonical
   packet and consumers fall back to reading the directory.
3. **Carry lexical topic candidates only and document "empty means not run" when the
   packet profile is the corpus profile** — no bump, but the meaning rests on an
   inference from profile ids: a hidden convention.

### DEC-RC-086: how coverage expresses a disabled interpretation pass

1. **Nullable ratio plus `interpretation_enabled`, mirroring embeddings; schema v2 for
   coverage and the qualification report** — one convention for not-run passes;
   breaking for numeric readers.
2. **Additive flag; eligibility computed independently so a disabled run reports
   covered 0 / ratio 0** — no bump; a zero ratio still reads as "tried and failed".
3. **Additive flag only, keep eligible 0 / ratio 1** — leaves a figure that contradicts
   the flag.

### DEC-RC-088: replace the singular decoder identity or extend it

1. **Replace with a `decoder_profiles` list; schema v2** — truthful; breaking for readers
   of `text_decoder_id`.
2. **Correct `text_decoder_id` to the registry's text decoder and add
   `decoder_profiles`** — additive, but a singular field still implies one decoder for
   multi-format ratios.

## Decision

The owner adopted the recommendation for each decision.

**DEC-RC-076: option 1, plus lexical topic carry-across.**

1. The packet gains `domains_not_run: {domain, reason}[]`, in `CORPUS_PAYLOAD_FIELDS`
   order, bound into the semantic hash; `SCHEMA_HASH` binds the field name.
   `CORPUS_INTELLIGENCE_PACKET_VERSION` moves 1.0.0 → 1.1.0. `BuildCorpusIntelligenceInput`
   requires `domainsNotRun`: an absent statement would claim every pass ran.
2. A domain is declared not run only when **every** pass that can fill it was skipped.
   With semantic analysis off, `semantic_pair_relations`, `consolidation_candidates`,
   `reasoning_candidates` and `reasoning_evidence_pack_refs` are declared; with topic
   candidates also off, `topic_candidates` is declared too. `project_candidates` always
   has its lexical pass and is never declared; duplicates, readiness and work signals are
   not optional passes. This reading reconciles the packet's own REG-a ("topic … not
   run") with REG-d (lexical topics carried): carried lexical topics mean the topic
   domain ran, exactly as carried lexical projects mean the project domain ran, and each
   cluster names its pass in its own `analysis_profile`.
3. The validator refuses a `domains_not_run` entry that names an unknown domain, repeats
   a domain, has no reason, or names a domain that carries entries. A refused packet
   fails the run (the CLI already fails on any validation error).
4. `result.candidates.topic_candidates` is carried as `TOPIC_CANDIDATE` clusters with the
   lexical profile `{topic_candidate_method, topic_candidate_version,
   candidate_profile_hash}`, `cross_root` from `spans_roots`, `cross_archive` by the
   archive-ancestry rule already applied to lexical project candidates (over the member
   paths), `confidence_class: "weak"` (the vocabulary's floor, as for lexical projects)
   and no ambiguity flags. In a run with semantic analysis on, the topic domain carries
   both families, distinguished by `analysis_profile`.

**DEC-RC-086: option 1.** `CorpusCoverage` gains `interpretation_enabled`, and
`interpretation_coverage` is `CoverageRatio | null` — null when interpretation did not
run. Eligibility is computed from the extractors alone, independently of the switch, and
an enabled run keeps today's ratio over that set. `CORPUS_COVERAGE_SCHEMA` moves to
`l9.corpus-coverage/v2` (and the corpus index's document listing with it). The CLI
summary prints `interpreted      disabled (--no-interpret); not run` instead of `0/0`.

**DEC-RC-088: replace, in the same v2 bump.** `DecoderCoverage` drops
`text_decoder_id`/`text_decoder_version` and gains `decoder_profiles`: the cold run's
`snapshot.analysis.document_decoder_profiles`, sorted (the registry's `id@version`
profile plus the manifest reader). It also gains `interpretation_enabled`, and
`interpretation` is nullable as above. `CORPUS_QUALIFICATION_SCHEMA` moves to
`l9.corpus-qualification-report/v2`; `corpus_qualification.ts` no longer imports the
`TEXT_DECODER_*` constants (they remain in `corpus_scan.ts` as an internal fallback).

**RC-089 (value correction, no decision).** `distinct_extension_count` is computed from
each artifact's `root_relative_path` basename (an archive member `x.zip!/README` →
`README`) with the scan's own rule: a dot at index ≤ 0 is no extension.

**Deferred to this ADR's follow-up, not decided here:** DEC-RC-087 recommended naming
`null` as the decoder of an artifact no decoder claims (a document-index v3). WU-050
corrects the decoder-claimed artifacts refused before decoding without a schema change;
the unclaimed-artifact `decoder_id` fallback is unchanged and stays a recorded follow-up.

## Consequences

- **Consumer-visible, breaking for strict readers.** `l9-constellation-topology`'s
  corpus-intelligence models are closed to extra keys (the ADR-055 precedent): it must
  admit `packet_version` 1.1.0 and the top-level `domains_not_run` array of
  `{domain: <one of the nine payload fields>, reason: string}`, include it in its
  semantic-hash recomputation (the producer hashes it between `corpus` and
  `schema_hash`), and accept lexical-profile `TOPIC_CANDIDATE` clusters. The consumer
  fixture produced by `tests/helpers/emit_corpus_intelligence_fixture.ts` must be
  regenerated and verified by the consumer before release.
- Default-run packets differ from 1.0.0 packets only by the empty `domains_not_run`,
  the version and schema hash, and the carried lexical topic clusters.
- `corpus-coverage.json` readers must handle `interpretation_coverage: null` and read
  `interpretation_enabled`; qualification-report readers must read `decoder_profiles`
  instead of `text_decoder_id`/`text_decoder_version`, and handle a null
  `decoder_coverage.interpretation`. Both are versioned by schema id.
- Enabled-run coverage figures and every other ratio are unchanged;
  `distinct_extension_count` changes only where a root label contains a dot.
- Documentation that names `l9.corpus-coverage/v1` or
  `l9.corpus-qualification-report/v1` (for example `docs/corpus-archaeology.md`) is
  updated with the integration of this ADR.
