# ADR-092: A pinned --generated-at pins every time a corpus generation records

## Status

Proposed. Candidate for owner review. CLI-only change; no package export, public API,
packet, identity formula or consumer contract changes.

ADR numbers 088–091 are taken by an unpublished stack (the re-landed ADR-088 of PR #140
and ADR-089–091); this record takes the next free number so the two cannot collide.

## Date

2026-11-09

## Context

`npm run local-source -- --root … --generated-at ISO` documents `--generated-at` as the
timestamp recorded in the bundle, with a deterministic epoch by default. Single-source
mode honours it. Corpus mode did not:

- it never passed the value to `runCorpusScan`, so root packets always recorded the epoch;
- it recorded `new Date()` as each root's acquisition-manifest `observed_at` and as the
  corpus-intelligence packet and bundle-manifest `created_at`;
- it emitted each root's Repository Model bundle without the value, so the bundle manifest
  and validation receipt recorded the epoch while the packet beside them did not.

`generation_id` hashes every file a generation publishes, so two runs over byte-identical
sources with the same flags and the same `--generated-at` never published the same
generation. Observed on this repository's `docs/` tree: after normalizing only those two
wall-clock fields, every other file was identical. None of the semantic identities
(`corpus_source_snapshot_id`, `corpus_analysis_id`, root packet ids, the corpus-intelligence
`packet_id` / `semantic_hash`) is affected by any of these times; they are excluded from
those hashes by design.

## Options Considered

### Option A: make the default deterministic (epoch everywhere when no flag is given)

- Pros: every run reproducible without a flag.
- Cons: changes every default run's recorded `observed_at` from a real observation time to
  the epoch, which is a behaviour change for operators reading it, without being asked.

### Option B: honour --generated-at as the one recorded time of a pinned run

- Pros: opt-in; reproducible generations exactly when asked for; a default run is unchanged.
- Cons: a pinned `observed_at` is the operator's stated time, not a measured one.

## Decision

We choose **Option B**.

1. In corpus mode, a given `--generated-at` is passed to `runCorpusScan` as `generatedAt`
   (root packets) and `observedAt` (each root's acquisition manifest), to every root's
   Repository Model bundle (bundle manifest, validation receipt), and as the
   corpus-intelligence packet and bundle-manifest `createdAt`.
2. The value must be an exact UTC ISO-8601 instant, `YYYY-MM-DDTHH:MM:SS[.sss]Z`, that
   names a real date; anything else is refused with exit 2 before any source is read, so a
   malformed value is never written into a generation and one instant written two ways
   cannot publish two generations.
3. Without the flag nothing changes: root packets record the epoch, `observed_at` and the
   corpus-intelligence `created_at` record the wall clock.
4. `CURRENT.json`'s `committed_at` and the session file stay the wall clock: they record when
   the pointer moved and when the session was saved, and are not part of any generation.

## Consequences

- Two corpus runs over the same bytes with the same flags and the same `--generated-at`
  publish the same `generation_id` (verified on `docs/`: 154 recorded times, all pinned;
  identical generation id across runs). `tests/local_source_generated_at.test.ts` holds it.
- No semantic identity moves with or without the flag; only `generation_id` and the recorded
  times differ between a pinned and an unpinned run.
- Single-source mode's `--generated-at` is unchanged; its acquisition manifest `observed_at`
  remains the wall clock and is outside this decision.
