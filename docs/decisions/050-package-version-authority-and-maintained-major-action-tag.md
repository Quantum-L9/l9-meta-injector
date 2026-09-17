# ADR-050: Package version authority and maintained major Action tag

## Status

Accepted.

Supersedes the consumer-pin and release-identity policy in [ADR-029](029-v4-release-and-consumer-migration.md). The historical `v4.0.0` release facts recorded by ADR-029 remain valid.

## Context

The `v4.0.0` release contract required consumers to pin a 40-character commit SHA. That made every compatible patch or minor release a downstream repository-edit campaign. Release identity was also copied across package metadata, lock metadata, release-plan filenames, validation code, documentation, and consumer configuration, creating avoidable version drift.

The package is now distributed primarily as a GitHub composite Action. Compatible consumers need a stable release line, while release evidence still needs exact immutable provenance.

## Decision

1. `package.json#version` is the sole machine-authoritative semantic version for the current release candidate.
2. Exact releases use the derived tag `v${version}` and retain the exact release commit SHA as immutable provenance.
3. The supported GitHub Action consumer interface is the derived maintained-major tag `v${major}`. For major version 4, consumers use `Quantum-L9/l9-meta-injector@v4`.
4. A maintained-major tag moves only after the exact same-major release candidate passes the canonical gates and its exact GitHub Release is published.
5. Patch and minor releases within one major require no downstream version-edit PRs. Moving the maintained-major tag advances all consumers already on that release line.
6. A breaking major release creates a new maintained-major tag. Publishing `v5.x.y` must never move `v4` or silently migrate `@v4` consumers.
7. `main` is never a supported consumer pin. Exact `vX.Y.Z` tags and release commit SHAs remain valid audit and rollback identities, but are not the canonical downstream automation interface.
8. `package-lock.json` is derived package-manager metadata and must agree with `package.json#version` before a release candidate can pass.
9. The active release plan is derived from the package version at `docs/release/v${version}-release-plan.json`; release tooling must not hardcode a current version.
10. npm publication remains a separate authorization and is not required for GitHub Action distribution.
11. Dependencies used *inside* this Action remain pinned according to their own supply-chain policy. The maintained-major tag policy governs consumers of `l9-meta-injector`, not third-party dependencies embedded by it.

## Release sequence

For a compatible release:

1. Choose the next SemVer version once.
2. Synchronize package metadata and the active release plan from that decision.
3. Merge only after the repository-defined validation gates are green.
4. Publish the exact `vX.Y.Z` tag and GitHub Release at the validated main commit.
5. Move `vX` to that same commit.
6. Prove a real consumer resolves and executes `Quantum-L9/l9-meta-injector@vX`.

## Consequences

- Release provenance remains exact while downstream configuration stays stable.
- A patch/minor release becomes one upstream release operation rather than an organization-wide version-bump campaign.
- The mutable major tag is intentional and bounded to one compatibility line.
- Major-version migration remains explicit.
- Release tooling can fail closed on any package/lock/plan disagreement without embedding a literal current version.
