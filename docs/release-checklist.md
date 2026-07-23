# Release Checklist

## Source and API

- [ ] Exact release commit recorded.
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
- [ ] Tarball SHA-256 recorded.
- [ ] Checkout remained clean after `npm run validate`.

## Version and migration

- [ ] `package.json`, lockfile, API contract, package contract, and changelog all report `3.0.0`.
- [ ] `docs/migrations/v2-to-v3.md` covers former root imports.

## Publication

- [ ] Registry history verified.
- [ ] Constellation consumers inventoried.
- [ ] Distribution owner approval recorded.
- [ ] `docs/package-publication-decision.json` status changed to `approved` with evidence.
- [ ] `npm run check:publication` passed.

Do not publish merely because CI is green. CI proves implementation and packaging; the publication decision additionally requires external evidence.
