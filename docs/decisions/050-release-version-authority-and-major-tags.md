# ADR-050: One release version authority with maintained major consumer tags

## Status

Accepted. Supersedes ADR-029 for active consumer versioning.

## Decision

`package.json#version` is the sole persisted semantic-version authority. Release preparation derives the lockfile version, exact tag `vX.Y.Z`, release-plan identity, and maintained major tag `vX` from it. Exact GitHub Releases preserve immutable provenance; GitHub Action consumers use `Quantum-L9/l9-meta-injector@vX`.

After a validated release is created, automation advances only that release's matching major tag. Patch and minor releases therefore propagate to existing consumers without downstream version-bump pull requests. A new major tag never rewrites the prior major line. npm publication remains separately authorized.

## Consequences

- No current release version may be hardcoded in release validation.
- `@main` and raw commit SHA are not the canonical consumer interface for this package.
- Exact release commit SHA remains evidence for audit and rollback.
- Release automation must fail closed before moving a maintained major tag.
- A release plan is a preparation record; the immutable exact tag and its GitHub Release are the durable evidence that a release happened.

## Supersedes

ADR-029 for active release consumption and migration policy.
