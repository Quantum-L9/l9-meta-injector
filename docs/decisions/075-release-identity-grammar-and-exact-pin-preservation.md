# ADR-075: Release identity uses the strict SemVer core grammar, and consumer-ref projection leaves exact pins untouched

## Status

Accepted

Amends [ADR-050](050-release-version-authority-and-major-tags.md). Records a decision
already shipped in commit `2a47bdb` (WU-070: RC-107 / F-146, F-147). Consumes the
DEC-GAR-04 versioning rule adopted in
[ADR-057](057-comment-carrier-position-detection-and-value-safety.md).

## Date

2026-10-29

## Context

ADR-050 makes `package.json#version` the sole persisted version authority and derives
the exact tag `vX.Y.Z`, the release branch, the release-plan file and the maintained
major tag `vX` from it. `scripts/lib/release-identity.js` implements those derivations.
It already documented “Plain SemVer only”, but before `2a47bdb` two defects broke that
statement and ADR-050's provenance promise:

- **F-146.** `VERSION_PATTERN`, `RELEASE_BRANCH_PATTERN` and `PLAN_FILE_PATTERN` used
  `\d+` for each numeric part, so `4.02.0`, `04.2.0`, `4.2.00` and `release/v4.02.0`
  parsed as `4.2.0`: two distinct tag strings compared equal.
- **F-147.** `CONSUMER_REF_PATTERN` (`Quantum-L9/l9-meta-injector@(?:main|v\d+)`) had
  no right-hand boundary. Release preparation (`scripts/prepare-release.js`) runs
  `projectConsumerRefs` over `README.md`, so an exact pin such as `@v4.1.0` matched as
  `@v4` and was rewritten to the nonexistent `@v5.1.0` at the next major, and
  `findConsumerRefs` (used by `scripts/check-release-candidate.js`) reported it as `@v4`.

## Options Considered

The decision packet for DEC-RC-107 is not stored in this repository; the option it
adopted is recorded here as `2a47bdb` states it (“DEC-RC-107: leave untouched”).

### Exact pins: leave untouched (adopted)

- Pros: an exact pin is provenance (ADR-050: “Exact GitHub Releases preserve immutable
  provenance”); only the maintained-major and legacy `@main` forms are projected.
- Cons: a document that deliberately pins an exact release keeps that pin across
  majors; moving it is an editorial decision.

### Boundary lookahead `(?![.\w])` (packet suggestion, adapted)

- Pros: excludes every exact pin.
- Cons: also stops projecting a sentence-final `@v4.`; `2a47bdb` therefore uses
  `(?![\w-]|\.\w)`, which excludes every exact pin and keeps a trailing period a
  boundary.

## Decision

1. **Strict SemVer core.** Each numeric identifier follows SemVer 2.0.0 §2: `0` or a
   digit run without a leading zero (`NUMERIC_IDENTIFIER = (?:0|[1-9]\d*)`).
   `VERSION_PATTERN`, `RELEASE_BRANCH_PATTERN` (`release/v<core>`) and
   `PLAN_FILE_PATTERN` (`v<core>-release-plan.json`) share that grammar. A version with
   a leading zero is not plain SemVer: `parseVersion` returns `null`, and
   `releaseIdentity` and `compareVersions` throw. Prerelease and build-metadata
   versions stay rejected, as before.
2. **Exact pins are left untouched (DEC-RC-107).** `CONSUMER_REF_PATTERN` is
   `Quantum-L9/l9-meta-injector@(?:main|v\d+)(?![\w-]|\.\w)`: a ref followed by a word
   character, a hyphen, or `.` plus a word character is a longer ref and is neither
   found nor projected. `@v4` and `@main` followed by whitespace, a quote, a backtick,
   `)`, end of text or a sentence-final `.` still project to the new major, and
   projection stays idempotent.
3. **DEC-GAR-04 Option A.** The change ships within `v4` as a fix: the module already
   documented “Plain SemVer only”, and no documented contract is broken.

## Consequences

- Every release plan committed under `docs/release/` already matches the stricter
  grammar; a test asserts it.
- A `package.json#version`, release branch or plan filename with a leading-zero
  component is refused instead of aliasing another version.
- `README.md` exact pins survive the next major's release preparation.
- Tests: `tests/release_v4_contract.test.ts` (`REG-WU-070-RC-107-a` … `-f`).
