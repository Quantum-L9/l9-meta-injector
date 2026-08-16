# ADR-032: Repository semantics come from a separate deterministic interpretation stage

## Status

Accepted

## Date

2026-08-16

## Context

[ADR-030](030-repository-model-packet-egress.md) established Repository Model Packet egress
as a pure function of `InventoryResult`. [ADR-031](031-shared-manifest-filenames-are-not-package-manager-evidence.md)
removed filename-only package-manager inference and explicitly deferred content-based
manifest interpretation to "a separate decision … the same seam that document-level
semantic extraction requires". This is that decision.

The cost of the gap is measurable. Observing `cryptoxdog/golden-repo` at
`git:0b9f9202c80fc066e8c23dc1d783b99a2789160b` produced a packet with no package manager,
no package identity, no runtime constraint, no dependency, no capability and no entrypoint
— even though that repository states all of them in `pyproject.toml`, `spec.yaml` and
`engine/main.py`. Every one of those absences was accurate under the observation profile
and useless to a consumer.

The risk of closing the gap is the opposite failure: a producer that reads file bodies and
starts *concluding* things. A route decorator is not a working endpoint. A declared action
is not an implemented one. A distribution named in a manifest is not a resolved upstream
repository.

## Options Considered

### Option A: Read file bodies inside `buildRepositoryModelPacket`

- Pros: fewest moving parts.
- Cons: destroys the property that makes the packet auditable — that the builder is a pure
  function of explicit inputs. It also fuses observation policy and extraction policy into
  one unversioned blob, so a change in how a manifest is read becomes indistinguishable
  from a change in the repository.

### Option B: A separate interpretation stage feeding the same pure builder

- Pros: keeps `buildRepositoryModelPacket` a pure function, now of `InventoryResult` plus an
  explicit `InterpretationResult`. Extraction policy gets its own versioned identity that
  participates in packet identity. Each fact carries its own path, line, content hash,
  extractor id and evidence class, so any claim can be checked against the source.
- Cons: a second stage to keep deterministic, and a wider public surface.

### Option C: Model-assisted extraction

- Pros: broad coverage with little parser work.
- Cons: non-deterministic, unauditable, and unfalsifiable. Rejected outright: it would make
  the packet's central promise — evidence-backed facts — untrue.

## Decision

We choose **Option B**.

`src/repository_interpretation.ts` is a separate read-only stage over the same observation.
It ships three v1 extractors:

| Extractor | Inputs | Emits |
|---|---|---|
| `package-manifest` | `pyproject.toml`, `package.json`, `Cargo.toml` | package manager, package identity, runtime constraint, declared dependencies |
| `service-spec` | `spec.yaml`, `spec.yml` | declared service identity, declared actions |
| `python-routes` | `*.py` | FastAPI route decorator, method, path, handler symbol, in-handler `TODO` / `pass` / `NotImplementedError` markers |

Facts map into the **existing** `l9.repository-model` 1.0.0 domains only:

- `package_manager` → `repository.package_managers`
- `declared_dependency` → `artifact.dependencies` and `repository.unresolved_dependencies`
- `declared_route` → `repository.entrypoints` and a `ROUTES_TO` edge to the containing file
- `declared_action` → a `capabilities` record and a `DOCUMENTED_BY` edge to the spec file
- `package_identity`, `runtime_constraint`, `service_identity`, `implementation_marker` →
  evidence records plus a `contract-field-unavailable` diagnostic, because v1 has no
  dedicated field for them

The wire schema is not extended. A fact the current consumer contract cannot carry is
preserved as evidence and reported, never smuggled into an unrelated field.

Determinism is a hard constraint: no clock, no network, no randomness, no locale-sensitive
ordering, and no dependence on the checkout path. `INTERPRETATION_PROFILE_HASH` binds the
extractor versions and the epistemic policy, and folds into `packet.profile.hash`, so
changing *how* facts are read changes packet identity even when no repository byte moved.

Epistemic limits are enforced in the emitted confidence, not only in prose. Declared facts
carry `authority: "source"`. Observed route decorators are capped at `level: "medium"` with
`completeness: "partial"`, and capabilities are emitted with empty `implemented_by`,
`exposed_by` and `validated_by` — a declaration does not establish who realizes it.

## Consequences

- Repository Model Packets gain package identity, packaging, runtime constraints, declared
  dependencies, declared capabilities and observed HTTP entrypoints, each traceable to a
  path and, where the reader can establish it, a line.
- `buildRepositoryModelPacket` stays pure. `observeRepositoryModel` composes the two stages
  and accepts `interpret: false` to reproduce inventory-only behaviour.
- Packet semantic hashes change for every repository, because the profile descriptor now
  includes the interpretation policy. Both committed golden bundles are regenerated.
- A second golden bundle, `fixtures/repository-model/expected-interpreted-bundle`, carries
  the interpreted shape, and `npm run topology:conformance` proves the bound consumer
  accepts **both** bundles with no translation shim. Proving only the inventory-only shape
  would prove only that the shell is accepted.
- Producer-side validation gains `capability-cross-reference` and `assertions-are-evidenced`,
  so a capability or relationship the packet cannot trace to evidence fails before emission.
- The deferral recorded in ADR-031 is resolved. `pyproject.toml` now resolves a package
  manager when — and only when — its body declares one.
