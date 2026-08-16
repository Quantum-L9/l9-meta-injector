# ADR-032: Repository semantics come from a separate deterministic interpretation pass

## Status

Accepted

## Date

2026-08-16

## Context

[ADR-031](031-shared-manifest-filenames-are-not-package-manager-evidence.md) established
that a filename cannot identify a package manager, because the discriminator lives in the
file body and inventory observation does not read bodies. It resolved the immediate defect
by emitting a diagnostic instead of a guess — correct, but it left the underlying gap open:
this producer could see that `pyproject.toml` exists and could not see anything it says.

The gap is not limited to package managers. Against the frozen specimen
`cryptoxdog/golden-repo` at `git:0b9f9202c80fc066e8c23dc1d783b99a2789160b`, every one of the
following is stated plainly in a checked-in file and none of it reached the packet:

- `pyproject.toml` declares package `l9-service`, Python `^3.11`, FastAPI, Uvicorn, Poetry.
- `spec.yaml` declares service `golden-repo-ai-review-system` with actions `execute` and
  `describe`.
- `AGENTS.md` declares four specific files canonical.
- `contracts/packet_envelope_v1.yaml` declares Gate-compatible ingress, immutable tenant
  context, derivation rather than mutation, explicit replay, and reconstructable lineage.
- `README.md` declares the repository deprecated as an org bootstrap and names its
  replacement — and then, twenty lines later, calls itself the reference implementation to
  fork.
- `engine/main.py` registers `GET /health` and `POST /v1/execute`, and the `execute`
  handler body contains `# TODO: route to your engine handler`.

Downstream, `l9-constellation-topology` reconciled structure with no access to any of it.
It could not know what the repository claimed to be, so it could not detect that the
repository contradicts itself.

Three shapes make this hard to do safely. Prose is where repositories contradict
themselves, so a naive reader manufactures false certainty. Reading file bodies means
reading files that may hold credentials. And an extraction pass that is not perfectly
deterministic poisons every hash downstream of it.

## Decision

Interpretation is a **separate, separately versioned pass** that runs alongside inventory
and feeds the pure packet builder. `inventoryTree` keeps answering what exists;
`interpretRepository` answers what those files declare.

The seam is explicit rather than implicit. `interpretRepository` takes its extractor set as
a parameter instead of reaching for a registry, so the contract does not depend on the
implementation that satisfies it, and a caller can interpret with a reduced or substituted
profile without editing the orchestrator.

**Every assertion carries its evidence.** Exact repository-relative path, exact 1-based
inclusive line span, a bounded excerpt, the hash of the text actually parsed, the extractor
that produced it, its evidence class, authority, and confidence. An assertion that cannot
cite a valid span is dropped rather than emitted with a weaker qualifier.

**Determinism is structural.** No clock, no network, no randomness, no model, no
locale-dependent ordering. Assertions are emitted in a total order over path, span,
predicate, object and extractor. The profile hash binds the extractor set, so changing what
is extracted changes the identity of what was extracted.

**Extractors report; they do not resolve.** They recognize a closed vocabulary and stay
silent outside it. Competing claims are all emitted with their sources: a README that
declares itself both deprecated and a reference implementation states both things, and
deleting the weaker claim would destroy the evidence a consumer needs to recognize the
conflict at all. There is deliberately no `inferred` evidence class — an extractor that
would need one is out of scope for this profile.

**Secret safety is a refusal to read.** Candidate credential paths are never opened, so the
safest excerpt of a private key is the one never loaded. An assertion whose excerpt or
object nonetheless resembles a credential is dropped, not redacted: a redacted excerpt is
no longer evidence of anything.

Repository-model packet **1.1.0** carries the result. The payload gains an `assertions`
domain, and the shell gains an `interpretation_profile` present exactly when the pass ran,
so an inventory-only packet keeps the identity it had before the profile existed.

## Consequences

### Positive

- What a repository declares now survives to the consumer as typed, evidence-linked data.
- Contradictions become visible downstream instead of being flattened before they arrive.
- The extraction profile is versioned and hashed, so a change in extraction rules is a
  visible change in packet identity rather than a silent shift in meaning.
- Observation stays pure and cheap; interpretation can grow rules without perturbing the
  inventory contract.

### Costs and constraints

- Interpretation reads file bodies, which inventory did not. That is bounded by an explicit
  size limit, a refusal list, and a secret-value scan, but it is a real widening of what
  this producer touches.
- The extractor vocabulary is closed, so a repository stating something in an unrecognized
  form yields nothing. Silence is the intended failure direction, but it means recall grows
  only when the profile does.
- Packet 1.1.0 required a coordinated consumer change; producer and consumer moved in the
  same campaign so they cannot drift.

## Alternatives considered

- **Rejected:** Extend inventory to read bodies. It couples a cheap structural pass to an
  expensive semantic one and makes every inventory consumer pay for interpretation.
- **Rejected:** Emit semantics as diagnostics to avoid extending the contract. Diagnostics
  describe the run, not the repository; encoding truth there makes it unreadable without
  string parsing and unversionable in practice.
- **Rejected:** Resolve contradictions in the producer, emitting one winning claim. The
  producer has no authority rule to resolve them with, and discarding the loser destroys
  the evidence the consumer needs.
- **Rejected:** Use an LLM to extract semantics. It forfeits determinism, and every hash
  downstream depends on this pass being reproducible from bytes alone.
- **Rejected:** Redact secret-looking excerpts and keep the assertion. A redacted excerpt
  cites nothing, so the assertion no longer meets this ADR's own evidence bar.

## Compliance and validation

- `tests/interpretation.test.ts` asserts determinism across repeated runs and across
  checkout paths, order-independence with respect to extractor order, that every assertion
  carries a valid span and a `sha256:` source hash, that the profile hash binds the
  extractor set, that candidate secret paths are never interpreted, that no secret value is
  persisted from an innocuously named file, that excerpts are bounded, that competing README
  claims are all preserved, that route observation emits no verdict about the endpoint, and
  that a throwing extractor becomes a diagnostic rather than a crash.
- Producer validation refuses to emit an assertion lacking a resolvable hashed span, or one
  whose subject is not a repository in the same packet.
- Conformance against the bound consumer was re-proved rather than asserted: the golden
  bundle loads through the topology adapter with no translation shim at repository-model
  1.1.0, recorded in `docs/topology-conformance.json`.

## Related artifacts

- `src/interpretation.ts`
- `src/extractors/`
- `tests/interpretation.test.ts`
- `docs/topology-conformance.json`
- [ADR-030](030-repository-model-packet-egress.md)
- [ADR-031](031-shared-manifest-filenames-are-not-package-manager-evidence.md)
