# ADR-012: Retain committed dist with source and tarball parity proof

## Status

Accepted (retrospective)

## Date

2026-07-23

## Context

Consumers execute JavaScript and declaration files from the npm package, while maintainers edit TypeScript source. The repository commits `dist/`, so a source-only test suite is insufficient: generated files can become stale, incomplete, or inconsistent with the package contract.

The release process must prove both source-to-dist parity and real installed-consumer behavior.

## Options Considered

### Option A: Stop committing dist and build only during publication

- Pros: smaller source diffs; eliminates manual synchronization of generated files.
- Cons: shifts critical generation to release time; repository consumers cannot inspect the exact shipped output; publication can differ from reviewed commits unless separately attested.

### Option B: Commit dist but rely on reviewer inspection

- Pros: keeps shipped output visible; requires little additional tooling.
- Cons: stale or extra files are easy to miss; declarations and source maps may drift; visual review does not prove installed-package behavior.

### Option C: Commit dist and enforce deterministic parity plus packed-consumer tests

- Pros: binds generated output to reviewed source; detects missing, extra, changed, untracked, or unsafe files; tests the actual tarball and supported import boundaries.
- Cons: source changes produce larger diffs; validation takes longer; contributors must regenerate output in the same change.

## Decision

We choose **Option C**. `dist/` remains committed. `npm run check:dist` proves deterministic source parity, and `npm run test:packed` builds and installs the package in a clean consumer to verify runtime and declaration entrypoints.

## Consequences

- Every `src/` change that affects output must update `dist/` in the same commit.
- Generated output is reviewed but is never the source of truth.
- The package contract covers file inclusion, supported entrypoints, declaration compilation, and deep-import denial.
- `npm run validate` must continue to include distribution parity and packed-consumer proof.
- Larger generated diffs are accepted in exchange for release integrity.
