# ADR-030: Repository Model Packet egress from the meta injector

## Status

Accepted

## Date

2026-08-15

## Context

`Quantum-L9/l9-constellation-topology` compiles constellation topology from
`l9.repository-model` packets. Until now no producer emitted that packet, so topology had
to rediscover artifact truth itself on the normal path.

This repository already owns the observations the packet needs: `inventoryTree` walks a
repository, classifies every file, records content hashes, classification evidence, and
explicit unknowns. What was missing was a contract-accurate, deterministic egress surface.

Three constraints shaped the decision:

1. The topology consumer validates a recomputed semantic hash over a canonical
   serialization. Structural resemblance is not acceptance — the wire form has to match
   the consumer's `canonical_data` / `semantic_hash` rules exactly.
2. This package must not acquire a runtime dependency on topology, on Python, or on the
   network. Topology may only be checked out ephemerally to prove conformance.
3. Emitted semantics must be evidence-backed. Inventory evidence cannot establish
   repository role, ownership, entrypoints, or dependency direction.

## Options Considered

### Option A: Emit a topology-shaped TypeScript object and let topology adapt it

- Pros: smallest producer change.
- Cons: pushes a translation shim into the consumer, which the consumer contract does not
  have and should not grow; identity and hash rules would drift silently.

### Option B: Depend on the topology package to build packets

- Pros: one implementation of the contract.
- Cons: forbidden — it would make a TypeScript toolkit depend on a Python implementation
  at runtime, and would couple release cycles across the constellation seam.

### Option C: Mirror the wire contract in a dedicated producer module, prove it against the real consumer

- Pros: no runtime coupling; contract accuracy is proven by the actual consumer rather
  than asserted; determinism is testable inside this repository's own gate.
- Cons: the canonical serialization and hash rules exist in two languages and must be
  kept aligned deliberately.

## Decision

We choose **Option C**.

`src/repository_model.ts` mirrors the bound consumer's canonical form — code-point key
ordering, no separator whitespace, absent fields omitted, the same volatile-key strip set
before hashing — and builds the packet from inventory evidence. It is published as the
stable `./repository-model` subpath and as `scripts/repository-model-cli.js`.

Evidence discipline is part of the decision, not a detail:

- Capabilities stay empty; no capability evidence is available to this producer.
- Relationships carry only `CONTAINS` edges, which the inventory directly observed.
- `primary_role`, `owner_ids`, `entrypoints`, and dependency direction stay unresolved.
- Every one of those gaps is emitted as an explicit diagnostic rather than left silent.
- A missing content hash becomes the explicit `Unknown` value with `partial` completeness.

Conformance is proven against an ephemeral read-only checkout of the bound topology
revision by `scripts/topology-conformance.js`, which feeds the committed golden bundle to
`load_repository_model_bundle` and `RepositoryModelV1Adapter.adapt`. The result is recorded
in `docs/topology-conformance.json`.

## Consequences

- `npm run validate` stays runnable without a second repository or a Python toolchain, so
  the conformance script is deliberately outside it. The Vitest suite fails if the recorded
  conformance evidence drifts from the golden bundle it claims to describe, which keeps the
  claim honest between live runs.
- Packets are byte-deterministic by default: timestamps default to the same epoch constant
  the inventory already uses, and absolute checkout paths never reach semantic identity.
- Changing the emitted shape changes `schema_hash`, the golden bundle, and the recorded
  conformance evidence together. Re-running the conformance script is required, and a
  superseding ADR is required if the packet contract itself changes.
- If the topology consumer contract moves, this producer must be rebound to the new
  revision and re-proven; the recorded revision is the anchor for that comparison.
