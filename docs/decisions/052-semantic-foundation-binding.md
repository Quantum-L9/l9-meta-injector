# ADR-052: Semantic Foundation binding through meta-authority v2

## Status

Accepted

Related: [ADR-047](047-one-glob-dialect-and-fail-closed-repository-modes.md) (one
repository, one authority file), [ADR-048](048-organization-managed-l9-ci.md)
(org CI is consumed; org semantics are not), [ADR-051](051-inventory-derived-annotation-fields.md)
(unbound inventory remains harvest-or-Unknown).

## Date

2026-10-04

## Context

`Quantum-L9/.github` owns Semantic Foundation v3.6.0 under `semantics/`. That
language names authority, identity, artifact class, vocabulary, repository class,
and product kind. A product repository is supposed to cite those `artifact_id`s,
declare its own topology, and let derived realization follow. The `.github`
README says not to copy that tree into a product repo.

This package already consumes org CI (ADR-048, `.l9/ci.json`). It did not consume
org semantics. Pipeline authority was an operator `--authority` string. Namespace
defaulted to the folder name. Inventory used harvest-or-Unknown (ADR-051). A clone
without `.l9/meta-authority.yaml` therefore stamped `authority: Unknown` or an
operator-invented id.

Two existing "authority" channels did not unify: the stamped header string and
the writer-policy YAML (`l9.meta-authority/v1`).

## Options Considered

### Option A: Better default string

- Pros: smallest code change.
- Cons: still invents identity; does not cite org ledgers.

### Option B: New `.l9/semantic-binding.json`

- Pros: keeps writer policy and semantics separate.
- Cons: a second authority file beside the ADR-047 single-declaration scan.

### Option C: Extend `.l9/meta-authority.yaml` to `l9.meta-authority/v2`

- Pros: one resolver, one file, v1 remains accepted; cites ledgers by
  `artifact_id` and sha256 at one `.github` revision; derives header
  `authority`/`namespace` from `product.owner`/`product.id`.
- Cons: the narrow YAML parser grows two nested blocks.

## Decision

We choose **Option C**.

1. `l9.meta-authority/v2` adds `semantic_foundation` (repository, 40-hex
   revision, release, admission, ledgers) and `product` (id, owner, kind,
   archetype). v1 parse is unchanged.
2. This repository declares ProductKind `dependency` and
   `l9.dependency-archetype/semantic-subsystem@1`. Admission of Semantic
   Foundation v3.6.0 is recorded as `candidate`; the engine never upgrades it.
3. `resolveHeaderIdentity` is the single source of stamped `authority` and
   `namespace`. A bound root uses `product.owner` / `product.id`. A differing
   operator value is `META_AUTHORITY_IDENTITY_MISMATCH`. An invalid v2 file is
   `META_SEMANTIC_BINDING_INVALID` and refuses to stamp. An unbound root keeps
   today's required `--authority` and folder-name namespace.
4. Inventory uses the binding when present; otherwise ADR-051 harvest-or-Unknown.
5. `npm run semantics:verify` checks an operator-supplied `.github` checkout
   (HEAD equals revision; each cited `artifact_id` sha256-matches). It is not
   part of `npm run validate` (ADR-048).
6. No file under `.github/semantics/` is copied here.

## Consequences

- Header shape is unchanged; only the source of two values changes.
- Consumers with v1 files are unaffected.
- Adding this repository's own v2 file does not change selfpack: selfpack copies
  `fixtures/` into a temp root that has no binding.
- Vocabulary mapping for local `ArtifactType` / `ArtifactFamily` remains an
  explicit future Unknown.
- Repository registry and class ledgers admit no entries; this repo does not
  claim one.
