# ADR-084: Governed native-header semantic mapping (Phase 2, P2.2)

## Status

Accepted

## Date

2026-11-05

## Context

ADR-082 made the producer read native `L9_META` headers and emit each field as a declared source claim. It assigned no meaning, because the Semantic Foundation defined none and `authority_model.escalation_rules.authority_missing` is `block`. The consumer therefore held every header predicate as unsupported: 6,431 unknowns across the three acceptance repositories, all holding publication.

The Foundation now defines the meanings. `Quantum-L9/.github` v3.27.0 adds `l9.artifact-header-model/global@1` (ADR-024, PR #204, merged as `06bdc6b`). It states that:

- every header field is a source declaration;
- each of 30 fields has a defined meaning and a list of what it does not establish;
- no field projects a canonical relation.

The release is a candidate. The Foundation defines no admission-record form yet, so this repository binds it with `admission: candidate`, the same standing as the v3.6.0 binding it replaces.

Phase 2 P2.2 asks for a documented, versioned, hash-bound mapping, scoped by schema and consistent with the pinned Foundation, without a locally invented ontology.

## Options considered

### Option A: rename predicates to Foundation-native names

- Pros: consumers could read meaning from the predicate string alone.
- Cons: every consumer predicate changes for no change in meaning. The schema-version scoping (`l9v1` vs `l9v2`) is lost or has to be re-encoded.

### Option B: carry a semantic reference on each assertion

- Pros: each claim cites its definition directly.
- Cons: it adds a field to the RMP 1.1.0 assertion shape, which the consumer refuses (`extra="forbid"`). That is an incompatible wire change the Phase 2 pack forbids without approval (§5.3).

### Option C: one producer-side mapping table, bound to the ledger digest and to profile identity

- Pros:
  - No wire change.
  - Predicate names keep their schema scoping.
  - The meaning is documented once and its identity is part of every packet's semantic hash.
- Cons: a consumer learns the meaning from the mapping documentation and the ledger, not from the packet.

## Decision

We choose **Option C**.

1. **Table.** `src/semantic_mapping.ts` (`meta-injector-native-header-semantics` 1.0.0) transcribes the ledger's 30 fields: category, value kind and `ledger_ref`, plus the declared values for `status`.
   - Cardinality is derived from value kind: list kinds are `set`, every other kind is `single`.
   - It applies under `l9_schema` `1` and `2` only. The managed header is producer-owned and not mapped.
2. **One vocabulary.** `native-metadata/v1` reads its field vocabulary from the table. Its output is unchanged (same 30 fields), so its version stays 1.1.0.
3. **Policy.** Every entry is artifact-scoped, `declared`, authority `source`, verbatim, and has projection `none`.
   - Single-valued conflicts keep every claim and are flagged; sets aggregate.
   - Unresolved and out-of-vocabulary fields stay preserved without a meaning.
   - `role` and capability references are not mapped, because the ledger defines neither.
4. **Identity.** The mapping identity is hashed into the interpretation profile hash, and the profile moves to **1.4.0**. RMP stays `l9.repository-model` 1.1.0.
5. **Binding.** `.l9/meta-authority.yaml` is rebound from `.github` `31b4f4f` (v3.6.0) to `b3755ad` (v3.27.0). It adds `l9.artifact-header-model/global@1` and updates the digests of the three cited ledgers that changed since v3.6.0: `authority-model`, `product-kinds` and `dependency-archetypes`.
6. **Drift guards.**
   - A test fails when the table's cited digest differs from the binding.
   - `semantics:verify` compares the table field by field with the bound ledger and fails on any disagreement.
7. **P2.3.** No wire field is added. `source_content_hash` keeps its whole-file meaning. RMP artifact `body_hash` stays undefined until its semantics are approved (pack §5.3).

## Consequences

- Every governed header predicate has one documented meaning per schema, in [`docs/semantic-mapping.md`](../semantic-mapping.md).
- Packet identities change once: profile 1.4.0 with the mapping hash. Golden bundles and the topology conformance record are regenerated.
- The consumer can classify header predicates by the mapping's cardinality and citation. No header-derived ownership, governance, dependency or capability edge is permitted by this producer's policy or by the ledger.
- Supersedes nothing. It extends ADR-082 and depends on ADR-052 for the binding format.
