# ADR-088: A read-only evidence query over one pinned corpus generation

## Status

Proposed. Candidate for owner review. The surface ships as a repository-local CLI and a
non-exported module; nothing in the package contract, the public API, the corpus
compilation pipeline or any Accepted contract changes. The owner decides whether the
response contract `l9.corpus-evidence-query/v1` is one this package keeps versioned.

## Date

2026-11-07

## Context

A local-source run publishes everything it concluded into `generations/<id>/` under one
atomic pointer (ADR-042, ADR-066): the snapshot, the document index, the complete
work-signal payload with its manifest (ADR-043), the opt-in architecture-evidence payload
(ADR-087) and each root's Repository Model Packet. A developer holding that directory has
every record and no way to ask for three of them. Reading the JSONL by hand means trusting
it without checking the manifest, mixing records from whichever generation a glob found
first, and quietly treating a partial snapshot as the whole corpus.

Two facts bound the design. The work signals of text documents are in the packet with
line spans, and those of decoded formats are in the JSONL with block locators; a query that
read one source would answer "which documents say they are WIP" for Word documents or for
Markdown, not both. And every payload already carries a verifier the scan ran before it
published — `verifyDocumentWorkSignalExport`, `verifyArchitectureEvidenceExport` — so a
reader can prove what it reads with the same functions rather than new ones.

## Options Considered

### Option A: a persisted query index beside the generation

- Pros: faster repeated queries.
- Cons: a second store that can disagree with the generation it indexes, with its own
  identity, staleness and integrity problems. Rejected as exactly the second claim store
  the contract forbids.

### Option B: a streaming, verifying read over the pinned generation's own files

- Pros: no new artifact; the verifiers are reused; every result is a record the
  generation wrote, with the identities it assigned; two queries over one generation are
  byte-identical.
- Cons: each query re-reads and re-verifies the payloads. For v1 that cost is the cost of
  not trusting them.

### Option C: semantic or ranked retrieval

- Rejected: a ranked answer is a conclusion about relevance the generation never recorded.

## Decision

We choose **Option B**.

1. `src/corpus_query.ts` exposes `queryCorpusEvidence` and `renderEvidenceQueryResponse`;
   `scripts/corpus-query-cli.js` (`npm run corpus-query`) is the one command. Neither is
   a package export; the script is listed as not shipped in the package contract.
2. `CURRENT.json` is resolved once and the generation it names is pinned. Every file read
   must be named by the pointer, resolve inside the generation after symlinks, and hash to
   the pointer's record. Payloads are verified with the scan's own verifiers and
   cross-checked against the snapshot's references; each root packet must be the packet
   the snapshot recorded. Any failure is `invalid` with no results.
3. Three sources are read and never mixed with another generation: the architecture
   evidence (by statement class), the work-signal payload (by predicate), and each root
   packet's artifact-scoped assertions (by predicate). The packet artifact id is joined to
   the corpus artifact id with `repositoryModelArtifactId` over the document index's own
   fields — a recomputation of an existing identity, not a new one.
4. Filters are literal: root key or id, artifact by either identity or corpus path, exact
   predicate, exact statement class, literal substring, declared kind, declared status,
   source, limit (≤ 500), excerpt byte ceiling. Status and kind filters match any of a
   document's declarations and every declaration is returned on every record.
5. Outcomes are `ok`, `empty`, `incomplete` (partial snapshot), `unavailable` (unknown or
   unobserved root or artifact), `unsupported` (a question this generation cannot answer)
   and `invalid`. The snapshot's verification class is carried verbatim with an
   evidence-age statement; `cached_unchanged_assumption` raises a diagnostic and is never
   relabelled.
6. Results are ordered by source, artifact id and record id; truncation is stated and
   there is no paging. The response carries no wall clock and no absolute path.
7. Not done, and out of scope: any change to acquisition, decoders, interpretation, the
   extractor, index compilation, packet construction, cache keys, identities or
   publication; any index, store, ranking, embedding, model, context assembly, authority
   resolution or supersession inference.

## Consequences

- A developer can ask a bounded evidence question of a completed corpus and receive
  independently verifiable records with correct identities and native coordinates,
  including contradictions, limitations and incomplete coverage.
- `l9.corpus-evidence-query/v1` is a new, additive response contract owned by this
  repository. The package contract, public API, every corpus identity and every published
  output are unchanged; the local-source CLI is untouched.
- Each query re-verifies the payloads it reads. A corpus large enough for that to matter
  is a reason to revisit, not a reason to cache.
