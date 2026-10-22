# ADR-056: Dependency updates land through one maintainer rebind, and the report stays bound to the whole tree

## Status

Accepted

## Date

2026-10-22

## Context

`CURRENT_VALIDATION_REPORT.md` records a digest over the bytes of every tracked and
untracked file except itself, and `tests/validation_report.test.ts` requires that
digest to equal the digest of the tree the suite runs in (INV-025: evidence is bound
to what it describes). Any change to `package-lock.json` therefore moves the digest
and fails Vitest and the smoke job.

Dependabot opens one branch per advisory. Each branch changes the lockfile and
nothing else, and Dependabot cannot run `npm run validate:report` or commit its
result. Six such branches (#101–#106) were open with the same single failure, and
seven advisories, two of them critical, accumulated on `main` behind them. The only
required check on `main` is the organization's central analysis, so those failures
did not block merging; they just made the branches look broken.

An automated rebind would need a workflow that regenerates the report on the
Dependabot branch and pushes a commit. A push made with the default `GITHUB_TOKEN`
does not start new workflow runs, so the rebind commit would arrive without checks;
a push that does start runs needs a GitHub App or personal token this repository
does not hold.

## Options Considered

### Option A: Narrow the report binding to source and generated output

- Pros: lockfile-only changes would no longer invalidate the report.
- Cons: the report would then describe a tree other than the one it ran over; a
  dependency bump can change test outcomes, which is exactly what the report is
  evidence of. Retracts INV-025 for the case it exists for.

### Option B: Exempt the report test on Dependabot branches

- Pros: trivial.
- Cons: a gate that is green by exemption proves nothing; forbidden by the test
  integrity policy this repository follows.

### Option C: Group updates and rebind once per group, by the maintainer

- Pros: INV-025 untouched; the report keeps describing the validated tree; one
  command lands a whole group; works with no new credential.
- Cons: a human runs the command; a group waits until someone does.

### Option D: Automated rebind workflow

- Pros: no human in the loop.
- Cons: needs a CI-triggering credential this repository does not have (recorded
  as an open unknown); until then it would produce commits without checks.

## Decision

We choose **Option C** now and keep **Option D** open behind its credential.

1. `.github/dependabot.yml` groups npm version updates (`dev-tooling`: vitest,
   `@vitest/*`, vite, typescript, eslint, typescript-eslint, `@types/node`;
   `transitive`: everything else) and groups security updates into one branch, so a
   rebind is paid once per group rather than once per package.
2. `npm run deps:rebind` (`scripts/deps-rebind.js`) runs `npm ci`, `npm run build`,
   `npm run manifest:update` and `npm run validate:report` in order and stops at the
   first failure. The maintainer reviews the diff and commits the dependency change
   and the rebound report as two commits, the same pair every code change already
   produces.
3. The report binding is unchanged. INV-025 gains the sentence that a dependency
   update is a tree change like any other and is rebound, never exempted.
4. The test toolchain moves to vitest 5 (vite 8, `@types/node` 22), which is the
   only line that fixes the critical tinypool and `@vitest/mocker` advisories.
   Vitest 5 requires Node 22.12, so `devEngines.runtime` declares that floor for
   people and CI working on this repository, `CI / smoke` runs on Node 22, and the
   workflows that read `node-version-file: package.json` resolve `engines.node`
   as before. `engines.node` stays `>=18`: the published package and the
   composite Action have no new runtime requirement.

## Consequences

- Dependabot branches #101–#106 are superseded by the grouped bump on this branch
  and closed when it merges.
- A maintainer landing a future group runs one command; a contributor on Node 20
  is told by npm at install time that the dev toolchain needs 22.12.
- Follow-up (separate decision): when a CI-triggering credential exists, a rebind
  workflow for Dependabot branches, bounded to `package.json`,
  `package-lock.json`, `docs/architecture-manifest.json` and the report.

## Amendment 2026-10-22: major versions are not group bumps

The first `dev-tooling` branch Dependabot opened under this decision (#108)
proposed `typescript` 7.0.2, `@types/node` 26, `eslint` 10 and
`typescript-eslint` 8.71 together. `typescript-eslint` 8.x declares a peer
range that stops at TypeScript 5.x, so `npm ci` failed with `ERESOLVE` before
any check ran; `@types/node` 26 describes a Node line this repository does not
run (`devEngines.runtime` is Node 22); an ESLint major carries a configuration
migration. None of these is a rebind, and a group that mixes them with the
patch and minor updates it was created for cannot land at all.

`.github/dependabot.yml` therefore limits both version-update groups
(`dev-tooling` and the `transitive` wildcard) to `minor` and `patch` updates.
Dependabot still opens a pull request for every major it sees, but as an
individual branch rather than inside a group, so a major stays visible, is
decided on its own (with its own decision when the public toolchain contract
moves) and cannot hold the group's minor and patch updates hostage. An
`ignore` rule was considered and rejected because it would hide majors from
Dependabot altogether. Minor and patch updates still arrive through the groups
and one `npm run deps:rebind`. #108 is closed as not landable in that shape;
Dependabot recreates the group under the amended configuration.
