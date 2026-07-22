# Release Integrity Checklist

This checklist covers the committed-distribution model established by RAA-006. It does not replace the public API/versioning decision tracked under RAA-007.

## Commit and source

- [ ] The exact release commit is recorded.
- [ ] `npm ci` completed from the committed lockfile.
- [ ] `npm run check:authority` passed.
- [ ] `npm run check:manifest` passed.
- [ ] `npm run check:dist` proved committed `dist/` is byte-identical to an isolated TypeScript build.
- [ ] The distribution check reported no missing, extra, changed, symlinked, or pre-dirty `dist/` files.

## Packed artifact

- [ ] `npm run test:packed` created the tarball outside the repository checkout.
- [ ] The tarball SHA-256 is recorded.
- [ ] Required package files were present.
- [ ] Forbidden source, test, report, legacy, and tooling paths were absent.
- [ ] The packed `dist/` file set exactly matched committed `dist/`.
- [ ] The tarball installed into a clean temporary consumer.
- [ ] Runtime import resolved from the installed tarball.
- [ ] A dry-run pipeline smoke test preserved its input bytes.
- [ ] The packaged declarations compiled through the repository-pinned TypeScript toolchain.

## Integration

- [ ] `npm run validate` passed at the PR head.
- [ ] GitHub Actions passed at that exact PR head.
- [ ] The checkout remained clean after validation.
- [ ] The resulting `main` commit passed post-merge CI.
- [ ] RAA-006 evidence records the tested source commit and integrated `main` commit separately.
