# ADR-079: Supported consumer install paths, proven by test, and a runtime-only tarball

## Status

Accepted

## Date

2026-11-03

## Context

`npm install l9-meta-injector` is not available: registry publication stays blocked
under ADR-070 until a distribution owner approves. A consumer repository can still take
this package three ways — the composite Action, a packed tarball, or a git dependency
(`npm install github:Quantum-L9/l9-meta-injector#<ref>`) — but until now only library
imports from a tarball installed with `--ignore-scripts` were tested. Nothing ran the bin
a consumer actually invokes, nothing tried a git dependency, and the bin was committed
mode `100644`.

Two further facts were established on 2026-11-03 (npm 10.9.9, Node 22.23.4):

- npm's documentation (`package-json.md`, "Git URLs as Dependencies") says a git
  dependency is rebuilt — cloned, all dependencies installed, scripts run, re-packed —
  when any of `build`, `prepare`, `prepack`, `preinstall`, `install` or `postinstall` is
  defined. This repository defines `build` and `prepack`. A probe that prefixed both
  scripts with a marker write and git-installed the result wrote **no** marker; adding a
  `prepare` script with a marker wrote it. Observed behaviour: only `prepare` triggers
  the rebuild. A git install of this repository therefore takes the committed `dist/`
  and needs no developer toolchain, but that rests on observed npm behaviour that its own
  documentation contradicts.
- The tarball shipped every file under `scripts/`, including release and publication
  tooling that reads `docs/`, which is not packed, and so cannot run from `node_modules`.

## Options Considered

### Option A: Rename `build` and drop `prepack` so no documented trigger remains

- Pros: matches npm's documentation exactly.
- Cons: every caller of `npm run build` (CI, release, `npm run` aliases, docs) changes for
  a failure the probe did not reproduce; `npm pack` would lose its integrity gate.

### Option B: Keep the scripts, prove the install paths by test, ship runtime scripts only

- Pros: no workflow churn; a regression — a future `prepare` script, or npm starting to
  honour `prepack` for git dependencies — fails a test instead of a consumer's install.
- Cons: relies on observed npm behaviour, guarded by the test rather than by construction.

## Decision

We choose **Option B**.

1. Supported consumer paths: the composite Action (`uses: Quantum-L9/l9-meta-injector@<ref>`),
   a packed tarball, and a git dependency pinned to a tag or commit. Registry install stays
   unavailable (ADR-070).
2. `npm run test:packed` installs the packed tarball and drives
   `node_modules/.bin/l9-meta-injector` inside a freshly generated git repository:
   `--help`, `inventory .`, `check` (expects the missing-index drift), `apply`, `check`
   (expects clean), with source bytes unchanged under the `central_manifest` carrier.
   `--git-install` additionally installs the committed HEAD as `git+file://…#<sha>` and
   runs the same proof; CI runs it on clean checkouts.
3. The repository defines no `prepare` script. Adding one is a change to this decision.
4. `package.json#files` lists the 13 runtime scripts — `operation-cli.js`, the dispatched
   `inventory`/`check-cli`/`apply-cli`/`skills-cli`, the `pipeline-cli`,
   `repository-model-cli`, `local-source-cli` and `corpus-qualification` CLIs, and the four
   `scripts/lib` modules they load. `docs/package-contract.json` requires
   `scripts/operation-cli.js` and forbids every repository-maintenance script, so tooling
   cannot drift back into the tarball.
5. `scripts/operation-cli.js` is committed executable.

## Consequences

- The tarball no longer contains release, publication, conformance, validation-report,
  selfpack or architecture-manifest tooling. Anyone running those from `node_modules`
  must use a checkout; none was documented as a consumer surface.
- A consumer of the `@v4` major tag receives these changes only after the next release;
  until then, pin the merge commit.
