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

We choose **Option B**.

1. **The repository record is always evidence-backed.** `buildRepositoryModelPacket`
   emits one `observed` evidence record for the repository subject (field
   `artifact_ids`, source path `.`, the source revision, the artifact count and the
   snapshot semantic hash) and references it from the repository record before any
   derived fact. A record that claims `validated-machine` authority therefore never
   carries empty `evidence_refs`.
2. **Package manifests are read through the interpretation seam.** `package.json`
   (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`,
   `name`, `version`, `bin`, `main`, `exports`) and `pyproject.toml`
   (`[project] name`, `version`, `dependencies`, `[project.scripts]`) are parsed by a
   dedicated extractor. Each declared dependency becomes one `package.dependency`
   assertion whose `evidence_class` is `declared`, whose `source_range` names the
   manifest line, whose `evidence_excerpt` is that line, and whose
   `source_content_hash` is the manifest's hash. `package.name` and `package.version`
   are asserted the same way.
3. **Declared dependencies become `DEPENDS_ON` relationships** from the repository to
   `package:<name>` external identities, each citing the assertion's evidence record,
   and are listed in `unresolved_dependencies` so the consumer can resolve them to
   upstream repositories by name. Entrypoints declared by `bin`, `main` and
   `[project.scripts]` populate `entrypoints`.
4. **The unsupported-by-evidence diagnostics tell the truth.** The `dependencies` and
   `entrypoints` rows are emitted only when no manifest was observed. `capabilities`,
   `primary_role` and `owner_ids` remain unsupported: no route, service or ownership
   evidence exists in this producer.
5. **The interpretation profile moves to 1.2.0** with the manifest extractor listed
   in `extractor_versions`. `packet_version` stays 1.1.0.

Other manifest families (`requirements*.txt`, `go.mod`, `Cargo.toml`) are admitted
future extractors under the same rules and are not read by this decision.

## Consequences

- The sample-repo and local-source golden bundles change: more evidence, more
  assertions, `DEPENDS_ON` relationships, and two fewer diagnostics where a manifest
  exists. The topology-conformance record is regenerated against the consumer.
- A declared dependency is never promoted to `observed`; the consumer's reconciliation
  keeps the distinction, and a manifest that lies produces a declared claim, not a fact.
- `docs/public-api-contract.json` gains the extractor's exported names where the
  public surface exposes them; `check:api` gates the change.
- Follow-up: once the consumer retires `adapt-meta-corpus`, the same extractor feeds
  the corpus-intelligence packet (separate decision).
