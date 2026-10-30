# Release Checklist

## Source and API

- [ ] Exact release commit recorded — the immutable `vX.Y.Z` tag and its GitHub Release are that record. A release plan states only what was prepared and never claims released state.
- [ ] `npm ci` completed from the committed lockfile.
- [ ] `npm run check:api` passed.
- [ ] Root runtime exports match the stable orchestration inventory.
- [ ] Stable and experimental subpath inventories match the API contract.
- [ ] Declaration consumer compilation passed.
- [ ] Unlisted deep imports failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Architecture and distribution

- [ ] `npm run check:authority` passed.
- [ ] `npm run check:manifest` passed.
- [ ] `npm run check:dist` proved source-to-committed parity.
- [ ] `npm run test:packed` proved installed runtime and declarations.
- [ ] `npm run check:release-candidate` passed (release identity + packed CLI containment).
- [ ] The packed `l9-meta-injector` CLI dispatches each mode from the package root (not just the file list).
- [ ] Tarball SHA-256 recorded.
- [ ] Checkout remained clean after `npm run validate`.

## Version and migration

- [ ] `package.json`, lockfile, API contract, package contract, and changelog all report the same version, as `npm run check:release-candidate` proves.
- [ ] `docs/migrations/v3-to-v4.md` covers the breaking v4 operation/carrier/frontmatter changes.

## Publication

- [ ] Registry history verified (evidence id `npm_registry_history`).
- [ ] Constellation consumers inventoried (evidence id `constellation_consumer_inventory`).
- [ ] Distribution owner approval recorded as `verified` (evidence id `distribution_owner_approval`; `not_applicable_with_reason` blocks).
- [ ] `docs/package-publication-decision.json` status changed to `approved`, each required evidence id listed exactly once, and `approved_version` set by the owner approval to `package.json#version` (ADR-070).
- [ ] `npm run check:publication` passed.

Do not publish merely because CI is green. CI proves implementation and packaging; the publication decision additionally requires external evidence.
