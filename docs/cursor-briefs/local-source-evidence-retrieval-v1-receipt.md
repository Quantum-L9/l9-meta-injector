# Brief — Local-Source Evidence Retrieval v1 (receipt)

Status snapshot for the read-only corpus evidence query (ADR-088, Proposed). Stacked on
the architecture-evidence projection (ADR-087, PR #139); it reads that projection's output
and changes nothing in it. Authority for the semantics is
[`docs/corpus-evidence-query.md`](../corpus-evidence-query.md).

## Revision binding

| Item | Value |
|---|---|
| Base | the head of PR #139 (`claude-mobile/dazzling-feynman-azm517`) |
| Branch | `claude-mobile/dazzling-feynman-azm517-retrieval` |
| Head | the commit this brief ships in, plus the regenerated validation report |

## Components reused (nothing reimplemented)

| Need | Existing component reused |
|---|---|
| resolve the published generation | `readCorpusCurrent` (`src/corpus_publish.ts`) and the pointer's own `files[].content_hash` |
| verify the work-signal payload | `verifyDocumentWorkSignalExport` (`src/corpus_work_signal_export.ts`) |
| verify the architecture evidence | `verifyArchitectureEvidenceExport` (`src/corpus_architecture_evidence.ts`) |
| join packet artifact ids to corpus artifact ids | `repositoryModelArtifactId` over `document-index.json` fields |
| snapshot, index, signals, packet shapes | `CorpusSnapshot`, `DocumentIndex`, `CorpusDocumentSignals`, `RepositoryModelPacket` types and schema constants |
| canonical output, ordering, hashing | `canonicalCorpusJson`, `compareCodePoints`, `sha256TextPrefixed` |
| statement-class vocabulary, excerpt bound | `ARCHITECTURE_STATEMENT_CLASSES`, `MAX_EXCERPT_LENGTH` |
| strict option grammar | the ADR-069 convention of `local-source-cli.js` |

New: `src/corpus_query.ts`, `scripts/corpus-query-cli.js` (`npm run corpus-query`),
`tests/corpus_query.test.ts`, `docs/corpus-evidence-query.md`, ADR-088. Listed as not
shipped in `docs/package-contract.json`; no package export.

## Invocation and contract

```bash
node scripts/corpus-query-cli.js --out <dir> [--root K] [--artifact ID|Root::path] [--predicate P] \
  [--class C] [--text T] [--kind K] [--status S] [--source N] [--limit N] [--max-excerpt-bytes N]
```

One `l9.corpus-evidence-query/v1` JSON document on stdout; exit `0` for `ok`/`empty`/
`incomplete`, `3` for `unavailable`/`unsupported`, `1` for `invalid`, `2` for usage. The
full field list is in `docs/corpus-evidence-query.md`.

## Representative responses (from a real generation of the mixed corpus)

`--class decision_statement --status wip --limit 1` — a WIP proposal's recorded decision,
returned beside the two statuses the document declared (`wip` in frontmatter, `blocked` at
the bottom), truncated at the limit with the whole match count stated:

```json
{"outcome": "ok", "match_count": 2, "returned_count": 1, "truncated": true,
 "generation": {"corpus_status": "complete", "verification_class": "fully_verified", "…": "…"},
 "results": [{
   "source": "architecture_evidence",
   "record_id": "architecture_evidence:1d6177e0…",
   "source_path": "plans/gate-routing-proposal.md", "format": "markdown",
   "statement_class": "decision_statement",
   "value": "Routing tables are derived from the packet header, not from node config.",
   "structured_locator": {"kind": "line_span", "line_start": 21, "line_end": 21},
   "block_id": "block:1964c852…",
   "bounded_excerpt": "Decision: Routing tables are derived from the packet header, not from node config.",
   "raw_content_hash": "sha256:277ad285…", "normalized_document_id": "normdoc:da53198e…",
   "artifact_id": "vsrc:16df4f49…", "rmp_artifact_id": "artifact:c5f2330d…",
   "document_declarations": {"kinds": [{"object": "proposal", "assertion_id": "assertion:a8c0d86d…"}],
                             "statuses": [{"object": "wip", "assertion_id": "assertion:3f75c33e…"}]},
   "epistemic_class": "source-declared", "authority_verified": false,
   "selection": {"roles": ["wip_proposal"], "selected": true}}]}
```

`--predicate work.status` — the same predicate from both coordinate systems: the Word
specification's block, and the Markdown documents' lines read from their packet:

```json
{"outcome": "ok", "match_count": 3,
 "sources": [["architecture_evidence", "verified", 16], ["document_work_signals", "verified", 4], ["repository_model_packet", "verified", 46]],
 "results": [
  {"source": "document_work_signals", "source_path": "specs/transport-packet-spec.docx", "value": "active",
   "locator": {"kind": "docx_block", "block_index": 3, "part": "word/document.xml"}, "excerpt": "Status: active"},
  {"source": "repository_model_packet", "source_path": "handoffs/chassis-auth-handoff.md", "value": "blocked",
   "locator": {"start_line": 3, "end_line": 3}, "excerpt": "Status: blocked"},
  {"source": "repository_model_packet", "source_path": "plans/gate-routing-proposal.md", "value": "wip",
   "locator": {"start_line": 3, "end_line": 3}, "excerpt": "status: wip"}]}
```

## Acceptance (tests/corpus_query.test.ts, 18 tests, all against real CLI-produced generations)

| Case | Evidence |
|---|---|
| A. architectural discovery | open questions filtered by `--text Gate` across Markdown and Word, each with ids, hash, block and coordinate; constraints of one document by corpus path, by `vsrc:` id and by `artifact:` id, identical answers |
| B. WIP discrimination | decisions with `--status wip` return `authority_verified: false`, `source-declared`, both declared statuses (`blocked`, `wip`) retained; CLI bytes equal the in-process render |
| C. exact retrieval | Markdown `work.status` from the packet with `source_range`, each cited line read back from the file and equal to the excerpt; Word `work.status` with a `docx_block` locator; `--max-excerpt-bytes` cuts are flagged |
| D. integrity refusal | one changed byte in a payload, a manifest that no longer matches (even with `CURRENT.json` rewritten to match), a tampered packet, a pointer naming `../`, a symlinked payload, an output with nothing published — each `invalid`, no results, null match count, CLI exit 1 |
| E. incomplete corpus | a partial snapshot answers `incomplete` with `missing_root_ids`; the unobserved root answers `unavailable` (exit 3); an incremental run's `cached_unchanged_assumption` is carried verbatim with a diagnostic; a class query against a generation without the projection is `unsupported` |
| F. compatibility | the generation's file hashes and `CURRENT.json` are unchanged by querying; identical questions give identical bytes; no absolute path, mount point or timestamp in a response; truncation at the limit over a total order; unknown class, source, limit or flag refused |

## Integrity, determinism and compatibility

- `npm run lint` exit 0; `npm run validate` exit 0 (2941 tests passed, 3 skipped, 205 files); the validation report regenerated and bound to this tree.
- No local-source output changed: the scan, decoders, extractors, index compilation, packet construction, cache keys, identities and publication are untouched by this branch (diff is confined to the new module, the new script, tests, docs and the package-contract/scripts entries).
- No new index, compiler, store or source writer: the query holds nothing between calls and writes nothing anywhere.

## Limitations and authority-bound decisions

- Each query re-verifies the payloads it reads; a corpus large enough for that to matter is a reason to revisit, not to cache.
- `--text` is a literal, case-sensitive substring over the value and excerpt; there is no case folding, tokenization or phrase search.
- Results are ordered by source, `artifact_id` and `record_id` (hashes), not by reading position; the coordinate on each record is the position.
- Packet assertions are filed as `source-declared` with their recorded `evidence_class` and `authority`; the query does not distinguish the packet's `declared` from `observed` classes beyond carrying them.
- ADR-088 is Proposed: whether `l9.corpus-evidence-query/v1` is a contract this package keeps versioned is the owner's decision. Nothing in the pipeline, identities, package contract or public API changed.
