# ADR-058: Scoped governed runs and canonical metadata-index ordering/validation

## Status

Accepted

Amends [ADR-025](025-deterministic-central-metadata-index.md),
[ADR-026](026-unified-carrier-aware-operation-dispatch.md) and
[ADR-047](047-one-glob-dialect-and-fail-closed-repository-modes.md).
Restores the gitignore contract that [ADR-017](017-omit-skill-protect-skills-mode.md)
already states for omit patterns.

## Date

2026-10-28

## Context

[ADR-025](025-deterministic-central-metadata-index.md) makes `.l9/metadata-index.jsonl`
the one canonical record per non-`hard_skip` path, and
[ADR-026](026-unified-carrier-aware-operation-dispatch.md) makes
`buildCarrierOperationPlan` the single planning boundary that check and apply share.
Both predate [ADR-047](047-one-glob-dialect-and-fail-closed-repository-modes.md), which
made a governed run's `--glob` a real path scope. No decision said what a scoped run
does with a repository-wide index, and four defects followed (remediation plan for
`bf66978`, reconciliation B02):

- **RC-009 / F-004 (HIGH).** `src/carrier_operation.ts:154` compiled the index from
  `pipeline.metadataSubjects`, which `discoverFiles(root, config.glob)` had already
  scoped. Nothing read the existing index. A scoped apply therefore wrote an index
  holding only in-scope records and deleted every other record while reporting
  `passed: true` (`src/apply.ts:139-149`), and a scoped check compared a complete index
  with scoped bytes and reported a correctly applied repository as stale
  (`metadataIndexDrift`, `src/carrier_operation.ts:186-215`). The run's own discovery
  ledger already recorded every out-of-scope file as `glob_filtered` or
  `extension_filtered` (`src/retrieval.ts:185-199`), but nothing used it.
- **RC-012 / F-098, F-099 (LOW).** `src/ordering.ts` states that every ordering that
  reaches a hash, manifest, packet or report is code-point ordering. The index sorted
  records by UTF-16 code unit (`src/metadata_index.ts:185-194`), so paths mixing astral
  characters with U+E000–U+FFFF sorted differently from `carrierDecisions`. Glob `?`
  compiled to `[^/]` without the `u` flag (`src/glob.ts:41-53, 94`,
  `src/omit.ts:113-135`), so it could never match an astral character, contrary to
  ADR-047 Decision 1 (“`?` matches one character”).
- **RC-013 / F-100 (LOW).** `normalizeRelativePath` (`src/metadata_index.ts:80-92`)
  enforced a subset of `schemas/metadata-index-record.schema.json`: no control-character,
  leading-dot or length rule, and `serializeMetadataIndex`/`parseMetadataIndex` accepted
  records with keys the schema's `additionalProperties: false` forbids. A TAB-named
  governed file produced a schema-invalid record, and INV-019's “metadata-index schema
  validation” had no test behind it.
- **RC-014 / F-101 (LOW).** `patternToRegExp` (`src/omit.ts:119-136`) anchored only a
  leading `/`. gitignore(5), which ADR-017 names as the omit syntax, anchors any pattern
  with a separator at the beginning or middle. `!docs/keep.md` re-included every nested
  `docs/keep.md` (fail-open for mutation) and `docs/a.md` omitted every nested copy.

## Options Considered

### DEC-RC-009: what a scoped run does with the index

#### Option A: Merge, keyed on the run's own discovery ledger

Replace records for in-scope paths, carry forward the existing records of paths the
ledger marked scope-filtered, and compare/apply the merged bytes.

- Pros: small change at the planning boundary; scoped check becomes a usable gate; no
  extra pipeline pass.
- Cons: completeness is guaranteed only by unscoped runs; out-of-scope stale records
  persist until one; scoped runs depend on the existing index parsing.

#### Option B: Scoped runs never materialize or compare the index

- Pros: simplest.
- Cons: violates INV-021/ADR-027 (every change enters one transaction with the index)
  and leaves the index silently stale for in-scope edits.

#### Option C: Always compile the index from the full population

- Pros: the index is always ADR-025-complete.
- Cons: a full pipeline pass per scoped run, scoped check fails on out-of-scope drift,
  and the pipeline/plan structure changes (largest blast radius).

Refusing every scoped apply once an index exists was rejected outright: it contradicts
ADR-047's supported scoped apply and its test.

### DEC-RC-012: index order

- **Option A:** sort records by `compareCodePoints`. One-time stale/rewrite for
  repositories with affected path pairs.
- **Option B:** keep code-unit order and document an exception to `src/ordering.ts`.
  Leaves two orders for one path set inside one plan.

### DEC-RC-013: where an unrepresentable path is stopped

- **Option A:** only the producer refuses. Smallest change; check throws instead of
  reporting.
- **Option B:** discovery records such a path with the existing blocking disposition and
  an explicit reason, plus producer/parser alignment as defence in depth.
- **Option C:** relax the schema. Weakens a published contract.

### DEC-RC-014: omit anchoring

- **Option A:** fix per gitignore now, with a migration note.
- **Option B:** anchor negations only. Keeps a non-gitignore dialect contrary to ADR-017.
- **Option C:** document the current semantics as the contract.

## Decision

The repository owner adopted the reconciliation recommendation for each decision.

1. **Scoped runs merge with the existing index (DEC-RC-009, Option A).** At the
   ADR-026 planning boundary, when the pipeline's discovery ledger holds any `file`
   entry with disposition `glob_filtered` or `extension_filtered`, the plan reads and
   parses the existing `.l9/metadata-index.jsonl` and carries forward, byte for byte,
   exactly the records whose path the ledger marked scope-filtered. Every other path's
   record comes from the current subjects, so an in-scope deletion or omission still
   drops its record. The union passes the existing `serializeMetadataIndex` validation,
   and metadata ids are re-checked for uniqueness across it (`DUPLICATE_METADATA_ID`).
   `metadataIndex.carrierDecisions` stays the in-scope decision set, so the
   check/apply parity assertion is unchanged.
   - The scope is the run's own ledger, not a new parameter. An unscoped run (no
     scope-filtered entries, which includes the default `**/*`) never reads the index
     and produces exactly today's bytes, including rebuilding a corrupt index.
   - The plan records the base it merged with as `CarrierOperationPlan.metadataIndexBase`
     (`{ exists, sha256?, unmergeableReason? }`, `null` for an unscoped run). Apply
     binds the index intent's `expectedExists`/`expectedHash` to that base, so an index
     changed between planning and commit fails the transaction
     (`TRANSACTION_PLAN_STALE`) and the concurrent bytes survive.
   - A base that is not a regular file or cannot be decoded and parsed makes the index
     unmergeable: check reports a `conflict` drift on `.l9/metadata-index.jsonl` naming
     the reason, and apply refuses with `METADATA_INDEX_UNMERGEABLE` before any write.
     Both advise an unscoped run, which rewrites the index.
2. **The index is in code-point order (DEC-RC-012, Option A).** Records are sorted by
   `compareCodePoints` in the serializer, compiler and parser, matching
   `carrierDecisions`. Canonical-JSON object keys keep code-unit order (RFC 8785
   convention). Glob regexes compile with the `u` flag (`globToRegExp`; discovery
   `iu`; omit `patternToRegExp`) so `?` matches exactly one code point and never `/`.
3. **Producer and parser enforce the shipped record schema (DEC-RC-013, Option B).**
   A record path containing U+0001–U+001F or U+007F, starting with `.`, or longer than
   4096 characters is refused, and a record whose key set is not exactly
   `{schema, path, carrier, artifact_type, content_hash, metadata}` is refused by the
   serializer and therefore by the parser. A test checks produced records against the
   schema's path pattern and key set. The recommendation allows the producer assertion
   first when the discovery half is deferred: classifying such a path at discovery as
   `unsupported_entry` with an explicit reason, so check reports instead of throwing,
   belongs to `src/retrieval.ts` and lands with its owner.
4. **Omit patterns anchor as gitignore does (DEC-RC-014, Option A).** After the
   trailing `/` is stripped, a pattern that starts with `/` or still contains a `/` is
   anchored at the root; `**/` prefixes still match at any depth; slash-free and
   trailing-slash-only patterns stay unanchored. This ships as a fix.

## Consequences

- Persisted `.l9/metadata-index.jsonl` keeps its format and schema (`l9.metadata-index/v1`).
  After a scoped apply it keeps out-of-scope records instead of losing them. A scoped
  check of a fully applied repository passes where it used to fail.
- A scoped apply on a repository without an index still writes only in-scope records;
  only an unscoped run guarantees ADR-025 completeness. Records of out-of-scope files
  that were deleted or became binary persist until an unscoped run reconciles them.
- A scoped apply over a corrupt or non-canonical index now refuses instead of replacing
  it. Indexes written before this decision that contain an astral/U+E000–U+FFFF path
  pair are no longer canonical: an unscoped check reports them stale once, an unscoped
  apply rewrites them, and a scoped run refuses until then.
- `CarrierOperationPlan` gains `metadataIndexBase` and `CompileMetadataIndexInput`
  gains optional `preservedRecords`. Both are additive; no export name changes.
- Repositories with a governed control-character path that apply previously
  “succeeded” on now refuse at planning, before any write; an index carrying extra
  keys is rejected (this package never wrote one).
- Behaviour change for omit patterns: an operator who wrote `dir/file` expecting
  any-depth matching loses omission of nested copies, which become eligible for
  mutation (still subject to `inline_allow`). The migration is `**/dir/file`.
  Negations re-include fewer paths. CHANGELOG records the index byte-order change and
  the anchoring fix with this migration hint.
- `INVARIANTS.md` INV-019 and INV-020 state the code-point order, schema enforcement
  and the scoped merge.
