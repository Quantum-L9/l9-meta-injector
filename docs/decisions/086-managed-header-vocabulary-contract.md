# ADR-086: Producer-owned, versioned managed-header vocabulary contract

## Status

Proposed. This is a candidate contract for owner approval. It is repository-accepted only when the meta-injector owner accepts this ADR. Acceptance here admits nothing on the consumer side and nothing in the Semantic Foundation.

## Date

2026-11-06

## Context

The managed header this package writes (`managed:l9-meta-injector`, carriers `managed-frontmatter` and `managed-comment`) has two production writers: the annotate pipeline (`buildMeta`, used by inject, apply and check) and the inventory annotator (`inventoryTree`). Both are read back by `native-metadata/v1` as claims under `meta.managed.<category>.<field>`. Thirteen fields carry meaning (`MANAGED_VOCABULARY` in `src/extractors/native_metadata.ts`). The meaning of those fields lived only in code: the writer derives them (`buildMeta`, `PRIMITIVE_TAXONOMY`, `resolveNamespace`, `resolveHeaderIdentity`) and the reader categorizes them.

l9-constellation-topology registers the same thirteen predicates (ADR-0034, predicate policy 1.3.0 and later) with definition refs of the form `l9-meta-injector:managed-header#fields.<field>`. That ref names no version and no published text. The consumer therefore restated the vocabulary from producer source and could not register allowed values. Freeze candidate `L9-SEMANTIC-LEVERAGE-FREEZE/1.0` holds decision D3 (managed-header predicates) for this reason: the predicates are implemented on both sides but not admitted.

Two further gaps make the vocabulary hard to interpret without the producer's source:

- The header field named `authority` is easily read as claim-level authority or as an `l9.authority-model/global@1` class. It is neither.
- Both writers also write fields outside the vocabulary (for example `content_hash`, `description`, `governs`, `inventory_type`). They arrive as `meta.managed.unsupported_field`, or as `meta.managed.unresolved_field` when declared Unknown, and nothing said that this is intended.

## Options Considered

### Option A: leave the meaning in code; the consumer keeps reading producer source

- Pros: no new artifact.
- Cons: no version the consumer can bind to, no allowed values, and the consumer keeps restating producer meaning, which is exactly what keeps D3 unadmitted.

### Option B: propose the vocabulary to the Semantic Foundation

- Pros: one global definition.
- Cons: the managed header is this package's own format, and the Foundation's artifact-header model defines native `L9_META` only (ADR-084). Moving producer meaning into the Foundation is a separate decision for the Foundation owner, and it is not needed for the consumer to bind to a version.

### Option C: a producer-owned, versioned, machine-readable contract checked against the writer and reader

- Pros: the producer states its own meaning once, with a version identity the consumer policy can name. A drift test keeps the contract equal to what the writer writes and the reader reads. No code, packet or wire change.
- Cons: one more document to keep current. The drift test bounds that cost.

## Decision

We choose **Option C**.

1. `docs/managed-header-vocabulary.json` is the contract. Its identity is `l9-meta-injector:managed-header@1.0.0`. The base `l9-meta-injector:managed-header` equals the vocabulary name the consumer already registers, and a field's versioned definition ref is `l9-meta-injector:managed-header@1.0.0#fields.<field>`.
2. For each of the thirteen fields the contract states the category, value kind, semantics and, where the producer has a closed set, allowed values:
   - `artifact_type`, `family`, `mcp_primitive` and `sharing_scope` are enums;
   - `callable`, `retrievable` and `injectable` are the booleans `true` and `false`.
3. Every field has subject scope `artifact` (the file that carries the header) and cardinality `single`. A second value or a second declaration for the same artifact is a competing claim. The producer does not choose between competing claims.
4. Every field is **declaration-only**: it states what the header declares, not what is true. Projection is `none`. No field may be projected into a canonical entity, relationship, identity, ownership, capability or canonical status.
5. The contract separates three things that share the word authority:
   - the header field `authority`, an attribution label: the bound `product.owner`, or the operator value when the repository is unbound;
   - claim-level authority, which is `source` for every header claim;
   - the global `l9.authority-model/global@1`, which this field neither instantiates nor is interpreted under.
6. The contract names both writers and how their values differ:
   - `id`: `<namespace>.<primitive folder>.<file stem>` from the annotate writer, `inv-<path hash>` from the inventory writer;
   - `title`: the basename slug from the annotate writer, a harvested title or the file name from the inventory writer;
   - `family` and `owner`: the inventory writer never derives them and only preserves harvested ones.

   A claim object is the decoded scalar value, not its quoted YAML form. The contract also records:
   - which artifact types carry `family` and which carry `owner`;
   - the writer's taxonomy relations (`mcp_primitive`, `callable` and `injectable` derive from `artifact_type`, and `retrievable` equals `injectable`). These are relations at write time. A reader receives them as claims, and a violation is evidence for the consumer to reconcile, not a value to correct.
   - that any key declared Unknown, empty, `~` or null arrives as `meta.managed.unresolved_field`, whether or not it is in the vocabulary, because the reader decides this before it consults the vocabulary;
   - that an out-of-vocabulary key with a value arrives as `meta.managed.unsupported_field`. The fields each writer writes outside the vocabulary are listed.
7. `tests/managed_header_vocabulary.test.ts` writes headers with both real writers, reads them back with `native-metadata/v1`, and fails when the contract and the code disagree. It checks field set, category, allowed values, enum unions in `src/schema.ts`, taxonomy, variant presence and the identity form.
8. Ownership: **the producer owns meaning. The consumer owns interpretation and reconciliation.** Changing a field's meaning, adding or removing a field, or narrowing an allowed-value set is a new contract version: minor for an addition, major for a removal or a change of meaning.

## Consequences

- l9-constellation-topology can name `l9-meta-injector:managed-header@1.0.0` in its consumer policy and register allowed values from the contract. Whether and when it does is that repository's decision. Until then D3 remains implemented but not admitted.
- No source, `dist/`, public API, extractor version, profile version or Repository Model Packet field changes. `native-metadata/v1` stays 1.3.0.
- The vocabulary stays outside the Semantic Foundation. This decision neither depends on nor implies admission of the repository's v3.27.0 binding (`b3755ad`, `admission: candidate`).
- Future changes to `MANAGED_VOCABULARY`, `PRIMITIVE_TAXONOMY`, the header variants or the enums in `src/schema.ts` fail the drift test until the contract version moves with them.
