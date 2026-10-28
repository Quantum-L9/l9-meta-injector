# ADR-065: Inventory content_hash scope versus duplicate-cluster byte equality

## Status

Accepted

Amends [ADR-051](051-inventory-derived-annotation-fields.md) item 5: it states
explicitly which front-matter bytes are inside inventory content identity, and what
an inventory duplicate cluster therefore claims.

## Date

2026-10-28

## Context

ADR-051 item 5 defines inventory `content_hash` for a UTF-8 regular file as "the
SHA-256 of the body with the L9 managed carrier removed (the same bytes
`injectFile` already hashed as `originalBodyHash`)". For a YAML front-matter
document those bytes are everything after the closing fence:
`tryReadUtf8Body` (`src/inventory.ts`) returns `managedCarrierFreeBody`
(`src/inject.ts`), which returns `inspectFrontMatterDocument(raw).body`. The
whole front-matter block — user keys such as `status` or `owner` as well as the
keys inventory writes — is outside the hash (RC-052, finding F-053).

That is consistent with inventory's own model. Inventory harvests every
front-matter key (`harvestInline` in `src/inventory_existing_meta.ts`) and
writes them back through `patchManagedFrontMatter` as part of the carrier meta,
so for inventory the front-matter block *is* the metadata carrier. It is also
what keeps `content_hash` stable across annotation: an unannotated document and
the same document after a live run share one hash.

The duplicate-cluster contract said otherwise. `buildDuplicateClusters`
documented "Equivalence is byte equality and nothing else", the `inventory.md`
report headed its total "Recoverable: N bytes" and its section a "dedup view",
and `DuplicateCluster.wasted_bytes` was "bytes recoverable if deduped". Two
documents with one body and different front matter formed a cluster offered as
recoverable bytes, which is dedup advice to delete a copy whose metadata differs.
Front-matter-only edits do not move `content_hash`, in inventory or in the
repository model that reuses it.

## Options Considered

### Option A: Front matter is the inventory metadata carrier (status quo, made explicit)

- Pros: matches inventory's harvest model and ADR-051's parenthetical; no hash
  churn for any consumer; no change to repository-model artifact or snapshot hashes.
- Cons: clusters must be documented as "same body, metadata may differ";
  front-matter-only edits stay invisible to `content_hash`.

### Option B: Only L9-emitted keys are excluded; user keys are content

- Pros: clusters become true duplicates; front-matter edits move `content_hash`.
- Cons: needs a normalized projection (parse, drop, canonical re-serialize)
  because `patchManagedFrontMatter` may re-render user scalars; ambiguous for
  `--schema` runs where keys are operator-defined; a one-time `content_hash`
  change for every front-matter document with user keys, and with it every
  repository-model snapshot of such a repository.

### Option C: Keep `content_hash`, add a raw or metadata-inclusive hash for clustering

- Pros: most precise.
- Cons: adds a field to the public `InventoryRecord` type and the public API
  contract.

## Decision

The owner chose **Option A** (DEC-RC-052).

1. **Content identity.** For a UTF-8 regular file, inventory `content_hash`
   covers the carrier-free content only. The metadata carrier is the L9 managed
   comment block for comment strategies, and, for a YAML front-matter document,
   the whole front-matter block from the opening fence through the closing fence —
   user keys included. Everything after the closing fence is inside the hash.
   An unsafe front-matter document (one `inspectFrontMatterDocument` refuses)
   is hashed as its raw text. Binaries, archives and oversize files keep the
   raw-byte hash. ADR-051 item 5 is otherwise unchanged.
2. **What a cluster means.** `buildDuplicateClusters` groups on `content_hash`
   equality and nothing else; what a cluster claims is what the producer's hash
   covers. An inventory cluster means "same carrier-free content": members'
   headers or front matter may differ. It is byte equality only where the hash is
   the raw-byte hash.
3. **Reports say so.** The `inventory.md` summary reports "Repeated content"
   rather than "Recoverable", the section is headed "Duplicate clusters (same
   carrier-free content)" with a note that headers and front matter may differ and
   should be compared before a copy is removed, and the table column is "repeated
   bytes". The `DuplicateCluster.wasted_bytes` documentation no longer calls the
   bytes recoverable.
4. **Injection is untouched.** `managedCarrierFreeBody` and `injectFile`'s
   `originalBodyHash` / body-preservation semantics do not change.

## Consequences

- No hash changes anywhere: inventory records, `inventory-duplicates.json`
  membership, and repository-model artifact and snapshot hashes are identical
  before and after this decision.
- `inventory-duplicates.json` keeps its shape and field names (`wasted_bytes`,
  `totalWastedBytes`); only their documented meaning is corrected.
- `inventory.md` wording changes (summary line, section heading, intro, one
  column header). A consumer parsing that Markdown must follow the new strings.
- Front-matter-only edits remain invisible to `content_hash`. Detecting them needs
  a separate, metadata-inclusive identity (Option C), which would be a public type
  change under its own ADR.
- `local-source` shares `buildDuplicateClusters` but hashes its own records; the
  corrected docstring applies to it unchanged.
