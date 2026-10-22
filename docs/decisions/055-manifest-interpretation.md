# ADR-055: Package manifests are read, and what they declare is asserted with evidence

## Status

Accepted. Supersedes the deferral of content-based manifest interpretation recorded in
[ADR-031](031-shared-manifest-filename-is-not-package-manager-evidence.md) and left open
by [ADR-032](032-deterministic-repository-interpretation-seam.md); both decisions
otherwise stand.

## Date

2026-10-22

## Context

The Repository Model Packet this producer emits is consumed by
`Quantum-L9/l9-constellation-topology`. That consumer projects `package.dependency`
assertions into `DEPENDS_ON` relationships to `package:<name>` identities, resolves
`unresolved_dependencies` to upstream repositories by name, merges repository and
artifact capability ids, and reads `entrypoints` from the repository record. Every one of
those inputs was empty in this producer's packets. The repository record reported
`entrypoints: []`, `upstream_repository_ids: []`, `unresolved_dependencies: []` and five
`unsupported-by-evidence` diagnostics, two of which said that dependency edges and
entrypoints "require manifest interpretation beyond inventory observation". The
consumer compiled a graph of `CONTAINS` edges and unknowns.

ADR-031 established that a filename is not package-manager evidence and deferred reading
manifest content. ADR-032 introduced the deterministic interpretation seam and the
`interpretation_profile`, through which this producer already emits line-ranged
`assertions` for a small predicate set. The seam exists; the manifest extractor behind
it does not.

Two constraints bound any change. The consumer admits `packet_version` 1.0.0 and 1.1.0
only, with every model closed to extra keys, so the packet shape cannot grow. And a
dependency a manifest declares is a declaration, not a validated machine fact: the
evidence class and authority must say so, or the consumer's conflict reconciliation
cannot tell a declared dependency from an observed one.

A second defect surfaced while closing this gap. Repository records carried
`authority: validated-machine` with `evidence_refs: []` whenever a tree yielded no
derived fact (no language, workflow, ADR or governance file). The consumer's
`evidence-canonical-claims-backed` check refuses exactly that combination, and its
own validation report records a real `local-source-cli` packet from this producer
failing on it.

## Options Considered

### Option A: Keep manifests unread; defer to a corpus-intelligence packet

- Pros: no producer change; the consumer's corpus path already exists.
- Cons: the consumer's roadmap retires that path once this producer emits canonical
  packets directly; dependency edges would stay absent from the repository-model
  packet every consumer pins today.

### Option B: Read package manifests behind the existing interpretation seam

- Pros: uses the ADR-032 seam and the consumer's existing predicate registry
  (`package.dependency`, `package.name`, `package.version`); packet shape unchanged;
  each assertion carries a line range, an excerpt and a content hash.
- Cons: a manifest can declare what the code does not use; the producer must label the
  claim as declared, never observed.

### Option C: Widen the packet with a dependencies section

- Pros: explicit.
- Cons: refused by the consumer (`extra=forbid`) until a coordinated 1.2.0; that is a
  separate contract change.

## Decision

We choose **Option B**, and the audit behind it corrected the premise: the seam already
carries a manifest extractor (`manifest/v1`, in `src/extractors/structured.ts`) that
asserts `package.dependency`, `package.name`, `package.version`,
`package.packaging_system` and related predicates for `package.json`, `pyproject.toml`
and `Cargo.toml`, with `evidence_class: declared`, a line range, a bounded excerpt and
the manifest's content hash. What was wrong was the record and the diagnostics around
those assertions, not the absence of them.

1. **The repository record is always evidence-backed.** `buildRepositoryModelPacket`
   emits one `observed` evidence record for the repository subject (field
   `artifact_ids`, source path `.`, the source revision, the artifact count and the
   snapshot semantic hash) and references it from the repository record before any
   derived fact. A record that claims `validated-machine` authority therefore never
   carries empty `evidence_refs`.
2. **Dependency edges are the consumer's projection, not the producer's record.**
   The consumer projects each `package.dependency` claim into a `DEPENDS_ON` edge to
   an `ExternalPackage` node it creates itself, and it turns every name in
   `unresolved_dependencies` that matches no observed repository into a
   publication-holding unknown. The producer therefore emits neither edges to
   `package:<name>` targets (the consumer's edge-endpoint invariant would reject a
   target it did not create) nor package names in `unresolved_dependencies`.
3. **The unsupported-by-evidence diagnostics tell the truth.** The `dependencies`
   row is emitted only when no `package.dependency` assertion was made against the
   repository; a packet never reports a field as unsupported beside its own claim.
   `entrypoints` stays unsupported until the consumer registers a predicate for it,
   because an unregistered predicate is kept and flagged as an unknown on the
   consumer side. `capabilities`, `primary_role` and `owner_ids` remain unsupported:
   no route, service or ownership evidence exists in this producer.
4. **The interpretation profile stays at 1.1.0.** No extraction rule changed; the
   packet's semantic identity moves because the repository evidence and the
   diagnostics moved.

Entrypoints from `bin`, `main` and `[project.scripts]`, and the `requirements*.txt` and
`go.mod` manifest families, are the admitted next extractor changes once the consumer's
predicate registry names them.

## Consequences

- The sample-repo and local-source golden bundles change: one more evidence record
  per repository, and one fewer diagnostic where a manifest declares a dependency.
  The topology-conformance record is regenerated against the consumer at its
  current main.
- A declared dependency is never promoted to `observed`; the consumer's reconciliation
  keeps the distinction, and a manifest that lies produces a declared claim, not a fact.
- The public API surface is unchanged; `check:api` still gates the build.
- Follow-up: a consumer-side `package.entrypoint` predicate, then the producer's
  entrypoint assertions (separate decision, both repositories).
