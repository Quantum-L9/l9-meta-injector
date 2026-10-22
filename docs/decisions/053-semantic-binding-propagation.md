# ADR-053: Semantic binding propagation

## Status

Accepted

Related: [ADR-047](047-one-glob-dialect-and-fail-closed-repository-modes.md)
(one repository, one authority file), [ADR-051](051-inventory-derived-annotation-fields.md)
(unbound inventory remains harvest-or-Unknown), [ADR-052](052-semantic-foundation-binding.md)
(v2 binding stamps `authority` and `namespace`).

## Date

2026-10-04

## Context

ADR-052 made `.l9/meta-authority.yaml` v2 the source of header `authority` and
`namespace`. Four downstream behaviors still ignored that binding:

1. `buildMeta` always stamped `owner: Unknown` on source, test, and script headers.
2. Operator `--namespace-glob` / `L9_INPUT_NAMESPACE_GLOBS` could re-label part of
   a bound tree under a namespace the product does not own.
3. `verify` required a `shared` file to live in the literal namespaces `shared` or
   `core`, even when the product already owned its namespace.
4. A run left no record of which binding produced the headers.

Unbound roots must stay byte-identical. Mapping the local taxonomy onto
`l9.vocabulary/global@1` is a separate campaign.

## Options Considered

### Option A: Per-mode patches

- Pros: smallest surface in each CLI.
- Cons: check, apply, pipeline, and the Action would each re-load the authority
  file; a miss would silently skip glob enforcement.

### Option B: New public exports and a per-file provenance field

- Pros: consumers can read the binding without inspecting the resolver result.
- Cons: grows the public name inventory and the metadata index schema for a
  run-level fact.

### Option C: Widen the existing resolver result

- Pros: one reader of the authority file; optional fields and optional trailing
  parameters; check and apply inherit through `planCarrierOperationAsync`;
  unbound output is unchanged.
- Cons: `apply-cli` and `check-cli` must parse globs before they resolve identity.

## Decision

We choose **Option C**.

1. `resolveHeaderIdentity` is still the only reader of `.l9/meta-authority.yaml`.
   On a bound root it carries `product` and `semanticFoundation`. Downstream code
   consumes that result and never re-loads the file.
2. On a bound root, any namespace glob whose `namespace` is not `product.id` is
   `META_AUTHORITY_IDENTITY_MISMATCH`. Unbound roots ignore this rule. Declared
   sub-namespaces in the v2 file are the future extension, not adopted now.
3. `buildMeta` takes an optional trailing `identity`. Source, test, and script
   headers use `owner: identity?.product?.owner ?? Unknown`. MetaV3
   `governance.owner` follows `meta.owner`. On a bound repository, `check`
   reports existing files stale until `apply` converges that owner; that drift
   is intended.
4. `verify` takes an optional `{ semanticallyBound }`. When true, the
   literal-namespace sharing-scope rule is skipped because the product owns its
   namespace. The flag is set only when `source === "semantic_binding"` (or
   apply sees `authority.product`). An invalid binding already fails closed with
   `META_SEMANTIC_BINDING_INVALID` before verify runs.
5. A bound `PipelineResult` carries `semanticBinding`, and the persisted
   `coverage-report.json` carries a top-level `semantic_binding` key, both naming
   the bound revision, admission, cited ledger ids, and `product.id`. Both are
   absent on an unbound run. No per-file header field is added.

## Consequences

- No new source file and no new public export names.
- Unbound selfpack stays byte-identical.
- Vocabulary mapping onto `l9.vocabulary/global@1` remains deferred.
- Sub-namespaces declared in the v2 file remain deferred.
