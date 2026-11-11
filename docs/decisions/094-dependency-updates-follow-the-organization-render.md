# ADR-094: Dependency updates follow the organization's rendered Dependabot configuration

## Status

Accepted (operator decision 2026-11-11, DEPS-LANE-1).

Supersedes the remainder of
[ADR-056](056-dependency-updates-and-report-binding.md): the hand-written,
repository-owned `.github/dependabot.yml` and its grouping rationale.
[ADR-093](093-retire-committed-per-pr-generated-artifacts.md) had already
superseded ADR-056's maintainer rebind.

## Date

2026-11-11

## Context

`Quantum-L9/.github` manages `.github/dependabot.yml` as a rendered seed file
(its ADR-0019). The render is deterministic per repository root. This
repository's class, `org_seeded_self_governed` (`policies/repo-classes.yml`),
materializes the `dependabot` category. Every seed entrypoint restores the
file whenever it differs from the render, and the only opt-out is
`.l9/no-sync`. This repository carried neither the render nor `.l9/no-sync`,
so its file was drift that the next dispatched seed would replace.

The hand-written file existed for two reasons. Both are gone:

- **Grouping to pay one rebind per group (ADR-056).** ADR-093 stopped
  committing the validation report and the architecture manifest, so a
  dependency update has nothing to rebind.
- **Holding back majors.** It sent `@types/node` majors to the ignore list and
  routed other majors into individual pull requests, after typescript 7 broke
  `npm ci` against `typescript-eslint` 8 (#108, #129). The organization render
  now ignores every semver-major in every ecosystem (ADR-0019 safe-only
  revision, 2026-11-11). A major is a deliberate upgrade, not a weekly pull
  request.

## Options Considered

### Option A: Keep the hand-written file and add `.l9/no-sync`

- Pros: the local grouping (`dev-tooling`, `transitive`, `security`) survives.
- Cons:
  - `.l9/no-sync` opts out of every managed seed file, not only this one.
  - It keeps a second dependency policy beside the organization's.
  - Majors would again arrive as pull requests that cannot pass (#129).

### Option B: A per-repository overlay merged into the render

- Pros: local groups on top of managed bytes.
- Cons:
  - No mechanism exists.
  - `Quantum-L9/.github` considered one and rejected it (ADR-0019, option 6),
    because its only candidate consumer was this repository and that need
    ended with ADR-093.

### Option C: Adopt the render byte-for-byte

- Pros:
  - No drift and no restore pull request.
  - Majors are ignored.
  - Core-owned tools are ignored.
  - A 7-day cooldown buffers against freshly published releases.
  - GitHub Actions pins get minor and patch updates too.
- Cons:
  - One `npm-minor-patch` group replaces the three local groups.
  - Security updates are no longer grouped into one branch.

## Decision

We choose **Option C**.

1. `.github/dependabot.yml` is exactly the organization render for this root
   (`npm` and `github-actions`). It is byte-identical to `Quantum-L9/.github`
   `ops/fixtures/dependabot/npm-only/expected.yml` at `dcd9d00`. It is never
   hand-edited. A change belongs in `Quantum-L9/.github`
   `policies/dependabot/`.
2. No test in this repository pins those bytes. The organization's render
   suite owns them, and a local pin would fail every legitimate restore that
   changes a fragment.
3. `npm run deps:rebind` is unchanged (ADR-093). It is the local equivalent of
   the CI gate for a dependency update.

## Consequences

- A Dependabot branch carries only `package.json` and `package-lock.json`, or a
  workflow pin. It is validated by the same required checks as any other
  head.
- GitHub Actions pin updates are new here. They need no other edit:
  - `check:authority` requires a 40-hex pin, not a specific SHA.
  - Moving `actions/checkout` and `actions/setup-node` to new SHAs in
    `action.yml` and every workflow kept `check:authority`, `check:api`,
    `check:release-candidate` and every test that reads those files green.
    That was checked locally while this decision was made.
- **Residual: `dist/`.** `dist/` stays committed and parity-checked
  (ADR-033), so a minor or patch `typescript` update that changes emitted
  output fails `check:dist` on its branch until `dist/` is rebuilt.
  - The organization's dependency lane (ADR-0019 dependency-lane revision,
    2026-11-11; implemented in `Quantum-L9/l9-ci-core`, not yet shipped)
    regenerates committed generated output and enables auto-merge for eligible
    updates.
  - Until it ships, such a branch needs `npm run build` and a commit of
    `dist/`.
  - This repository declares nothing for that lane yet. Core's repository
    contract admits exactly three keys in `.l9/repo-workflow.json`, so the
    declaration waits for Core to extend it.
- Every Dependabot pull request remains advisory until that lane ships.
