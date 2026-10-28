# ADR-067: Corpus-mode index schema id

## Status

Accepted

## Date

2026-10-28

## Context

[ADR-037](037-corpus-intelligence-artifact-scope-and-duplicate-topology.md) defines
`corpus-index.json` (`l9.corpus-index/v1`) as the single-root corpus projection:
`source`, `repository_model`, `analysis_profile`, `summary`, `artifacts`,
`work_signals`, duplicate topology, relations, candidates, archives and diagnostics.
`src/corpus_analysis.ts` and `src/corpus_report.ts` are normative for it
(`docs/contracts.md`).

Corpus mode (`--root`, multi-root) later added `src/corpus_index.ts`, a table of contents
of the run: roots with per-root references, missing roots, counts, the documents the run
wrote, an optional coverage section and a statement. It has no `artifacts` and no
`repository_model`. It is published under the same file name, `corpus-index.json`, and
its `CORPUS_INDEX_SCHEMA` reused the id `l9.corpus-index/v1` (RC-070, finding F-063,
`src/corpus_index.ts:22` beside `src/corpus_analysis.ts:41`).

Two structurally different documents therefore declared one schema id, so a consumer
dispatching on `schema` mis-parsed corpus-mode output. `docs/corpus-intelligence.md`
also stated that a work-signal record's corpus `artifact_id` resolves in
`corpus-index.json`, which is false for the corpus-mode document; it resolves in
`document-index.json` and in `corpus-snapshot.json` (as `virtual_source_id`).

## Options Considered

### Option A: A new schema id for the corpus-mode table of contents, same file name

- Pros: minimal; schema dispatch becomes safe; consumers that locate files by name are
  unaffected.
- Cons: a consumer that matched `l9.corpus-index/v1` on corpus-mode output must accept
  the new id.

### Option B: A new schema id and a new corpus-mode file name

- Pros: fully unambiguous.
- Cons: breaks file-name consumers, generation file lists, and the docs and tests that
  name `corpus-index.json`.

### Option C: Make corpus-mode output conform to the normative single-root shape

- Pros: one shape, one id.
- Cons: a large redesign of corpus-mode output, out of proportion to the defect.

## Decision

The owner adopted **Option A**.

1. The corpus-mode table of contents written by `src/corpus_index.ts` declares
   **`l9.corpus-mode-index/v1`**. The exported constant keeps its name,
   `CORPUS_INDEX_SCHEMA`, in `corpus_index.ts`.
2. The file name stays `corpus-index.json` in both modes. Consumers dispatch on
   `schema`, not on the file name.
3. The single-root `l9.corpus-index/v1` shape, its id and its normative owners
   (`src/corpus_analysis.ts`, `src/corpus_report.ts`) are unchanged. `src/corpus_index.ts`
   is normative for `l9.corpus-mode-index/v1`.
4. `docs/contracts.md` and `docs/corpus-intelligence.md` name both ids, and the
   corpus-mode resolution of a work-signal `artifact_id` is documented as
   `document-index.json` and `corpus-snapshot.json`, not `corpus-index.json`.

This amends ADR-037: `l9.corpus-index/v1` names the single-root projection only.

## Consequences

- **Breaking for corpus-mode consumers that match the schema id.** A consumer that
  accepted `l9.corpus-index/v1` from a `--root` run's `corpus-index.json` must accept
  `l9.corpus-mode-index/v1`. Downstream consumers outside this repository are unknown
  and must be checked before release; the CHANGELOG states the change.
- Local-source (single-root) output is byte-for-byte unchanged.
- Corpus-mode generation ids change, because the index bytes changed.
- No public API change: neither `corpus_index.ts` nor `corpus_analysis.ts` is in the
  public API contract.
