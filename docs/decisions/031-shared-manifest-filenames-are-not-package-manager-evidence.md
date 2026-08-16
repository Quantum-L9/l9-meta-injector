# ADR-031: A shared manifest filename is not package-manager evidence

## Status

Accepted. The manifest-interpretation deferral recorded below is resolved by
[ADR-032](032-deterministic-structured-interpretation.md); the decision itself stands.

## Date

2026-08-15

## Context

`buildRepositoryModelPacket` derived `package_managers` from filenames alone. The table
mapped `pyproject.toml` to the literal value `uv/pip`.

`pyproject.toml` is the PEP 621 manifest filename. Poetry, uv, PDM, Hatch and setuptools
all use it. The discriminator — `[tool.poetry]`, `[tool.uv]`, `build-backend` — lives in
the file body, which inventory observation does not read: `InventoryRecord.evidence_excerpt`
carries a classification rationale such as `config extension .toml`, not file content.

An E2E qualification run against the frozen external repository `cryptoxdog/golden-repo`
at `git:0b9f9202c80fc066e8c23dc1d783b99a2789160b` made the cost concrete. That repository
is a Poetry project: its `pyproject.toml` declares `[tool.poetry]` and
`build-backend = "poetry.core.masonry.api"`, and its README states `Packaging: Poetry`. It
commits no lockfile. The emitted packet reported `package_managers: ["npm", "pip", "uv/pip"]`
— omitting Poetry and asserting a manager the repository does not use.

The emitted evidence record carried `evidence_strength: "direct"` and
`authority: "validated-machine"` for that value. This contradicts the producer's own
standard, which elsewhere refuses to resolve what inventory cannot establish and emits
`unsupported-by-evidence` instead: entrypoints, dependencies, ownership, capabilities and
`primary_role` are all left explicitly unresolved with a stated reason.

Downstream consumers cannot recover from this. `l9-constellation-topology` reconciles the
packet without rescanning the source tree, so a wrong value at this stage is wrong for the
rest of the pipeline and lands in memory as an asserted fact.

## Options Considered

### Option A: Read manifest bodies inside the packet builder

- Pros: resolves Poetry, uv and PDM exactly; captures the fact the repository actually states.
- Cons: `buildRepositoryModelPacket` is a pure function of `InventoryResult`; giving it
  filesystem access breaks that boundary and the inventory-observation profile. Passing
  content in is a public contract change that belongs with a deliberate manifest- and
  document-interpretation stage, not with a correctness patch.

### Option B: Emit the ambiguity instead of a guess

- Pros: keeps the pure-function boundary and the observation profile; removes the false
  assertion immediately; states the coverage gap in the packet so consumers and operators
  can see precisely what is missing and why.
- Cons: `package_managers` loses a value for PEP 621 repositories that commit no lockfile.
  Absence is reported rather than resolved.

## Decision

We choose **Option B**.

`pyproject.toml` no longer resolves to a package manager. It is recorded in
`AMBIGUOUS_PACKAGE_MANIFESTS` and produces an `unsupported-by-evidence` diagnostic naming
the field and the observed path.

Lockfiles remain determinative, because a lockfile filename does identify its manager:
`poetry.lock` resolves to `poetry` and `uv.lock` resolves to `uv`. `uv.lock` was absent
from the table and is now present.

Content-based manifest interpretation is deferred to a separate decision. It is the same
seam that document-level semantic extraction requires, and the two should be designed
together rather than arrived at through a lookup-table edit.

## Consequences

- A PEP 621 repository with no lockfile reports no package manager and one explicit
  diagnostic. This is a reduction in asserted coverage and an increase in honest coverage.
- No evidence record claims `direct` strength for a filename-only inference.
- `uv`-managed repositories that commit `uv.lock` are now identified.
- Repository Model Packet semantic hashes change for any repository containing
  `pyproject.toml`. The packet contract shape is unchanged; the committed golden bundle
  fixture contains no `pyproject.toml` and is unaffected.
- Resolving Poetry versus uv versus setuptools requires the deferred manifest-interpretation
  decision. Until then the gap is visible in diagnostics rather than filled by a guess.
