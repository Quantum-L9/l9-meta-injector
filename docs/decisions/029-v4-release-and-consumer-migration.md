# ADR-029: Release 4.0.0 by immutable commit before migrating consumers

## Status

Superseded by [ADR-050](050-package-version-authority-and-maintained-major-action-tag.md).

The historical `v4.0.0` release facts and provenance recorded here remain valid. ADR-050 supersedes the consumer-pin and ongoing release-identity policy.

## Decision

The breaking carrier, transaction, and frontmatter changes converged in `v4.0.0`.
At that release, consumers were required to pin the final 40-character release commit. GitHub commit/tag consumption was sufficient for `l9-deploy`; npm publication remained optional and separately authorized.

That exact-SHA consumer rule is no longer the active downstream contract. ADR-050 establishes exact SemVer releases for provenance and maintained-major tags for compatible consumer automation.

## Historical consequences

- `v4.0.0` remains bound to its exact release commit.
- npm publication remains a separate authorization.
- The prior requirement to edit downstream consumers for every compatible release is superseded by ADR-050.
