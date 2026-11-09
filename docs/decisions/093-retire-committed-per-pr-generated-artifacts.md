# ADR-093: Retire the committed validation report and architecture manifest

## Status

Accepted. Supersedes in part
[ADR-042](042-binary-document-decoding-generational-publication-and-bounded-candidate-work.md)
(the committed `CURRENT_VALIDATION_REPORT.md`),
[ADR-045](045-archive-execution-and-transactional-materialization.md)
(the report's place in the tree) and
[ADR-056](056-dependency-updates-and-report-binding.md)
(the maintainer rebind of that report after a dependency update). Retires the
committed `docs/architecture-manifest.json` introduced with the architecture
authority (RAA-005, #31) and named by INV-006,
[ADR-033](033-skills-mode-repository-authority.md) and
[ADR-048](048-organization-managed-l9-ci.md).

## Date

2026-11-09

## Context

Two generated files were committed and checked against the tree on every run of
`npm run validate`:

- `CURRENT_VALIDATION_REPORT.md`, written by `npm run validate:report`. It records the
  exit codes of `npm run lint` and `npm run validate` and a SHA-256 digest of every
  tracked and untracked file except itself. `tests/validation_report.test.ts`
  required the committed copy to name the digest of the tree under test.
- `docs/architecture-manifest.json`, written by `npm run manifest:update`. It records
  the Git blob id of each of 313 authority-critical files. `npm run check:manifest`
  required the committed copy to equal a fresh computation.

The report changes on every change to any file, and the manifest on every change to
any of its 313 files: every `src/` file with its `dist/` output, `package.json`,
the lockfile, `CHANGELOG.md`, `README.md`, the CI workflow and most tests. Almost
every pull request therefore rewrote both, and any two open pull requests conflicted
on both. With pull requests stacked or open side by side, every base move forced the
same ritual on every branch above it: rebuild, `manifest:update`, `validate:report`,
commit, push. The conflicts carried no information; the operator had already
retired the concept once to get zero conflicts and faster merging, and this is that
drift reintroduced.

Neither file proved anything the run that checks it cannot compute. The manifest's
inputs are themselves committed, reviewed in the diff, and read by the same check
that hashes them, so a matching copy proved only that someone ran the generator. The
report proved that `lint` and `validate` exited zero on that tree, which is exactly
what the required CI jobs prove on the head of every pull request — on a runner the
author does not control. The pull request body the publication path (`make pr`)
composes already lists every file a change touches.

## Options Considered

### Option A: Keep the files and automate their regeneration

- Pros: no gate changes.
- Cons: the conflicts remain; an automated commit made with the default token starts
  no checks (ADR-056 Option D), and a credential that does is not held.

### Option B: Mark them `merge=ours` or exclude them from conflict detection

- Pros: fewer textual conflicts.
- Cons: the merged result is then stale by construction and fails the very check
  that requires it; it hides the problem instead of removing it.

### Option C: Compute both at check time and commit neither

- Pros: zero conflicts from generated evidence; every check that carried information
  still runs; the authority for a tree is the run over that tree.
- Cons: the repository no longer carries an offline record of a green run; that
  record moves to CI check runs and, for releases, a workflow artifact.

## Decision

We choose **Option C**.

1. `CURRENT_VALIDATION_REPORT.md` and `docs/architecture-manifest.json` are deleted
   and no longer committed.
2. `npm run validate:report` still runs `lint` and `validate`, writes the report and
   binds it to the tree digest; `--check` still refuses a stale or red report. The
   report path is gitignored. `release-prep.yml` runs `validate:report` and its
   `--check` as the release candidate proof and uploads the report as a workflow
   artifact instead of committing it.
3. `npm run check:manifest` (name and `package.json` text unchanged, as
   `check:authority` pins them) computes the manifest in memory: every
   authority-critical path must exist once as a regular file, never a symlink. It
   refuses a revived `docs/architecture-manifest.json`. `npm run manifest:update`
   is removed; `node scripts/generate-architecture-manifest.js` prints the computed
   manifest to stdout and writes nothing.
4. `npm run deps:rebind` keeps its name and becomes the local equivalent of the CI
   gate for a dependency update (`npm ci`, `build`, `lint`, `validate`); there is no
   longer anything to rebind.
5. Tests guard the retirement: neither file is tracked, the report path is ignored,
   and the manifest refusals (missing, duplicated, symlinked or retired path) are
   exercised.

## Consequences

- No pull request conflicts on generated evidence. Moving a base no longer requires
  regenerating and committing anything but `dist/`, which remains a committed,
  parity-checked mirror of `src/` (ADR-033, RAA-006).
- Still proven, by computation at CI time: every authority-critical file exists as a
  regular file (`check:manifest`); `lint` and `validate` pass on the exact head
  (the required CI jobs); the checkout stays clean after validation (CI smoke);
  for releases, a report bound to the prepared tree records a green verdict and is
  archived as an artifact.
- No longer proven, and accepted: that a specific committed tree was validated on
  the author's machine before push. CI on the head is the authority for that tree,
  and a committed claim about one machine's run was weaker evidence than the
  required check runs it duplicated. A reader of an old commit consults the CI run
  for that commit, not a file in it.
- INV-006 changes from "authority-critical files match the committed manifest" to
  "the manifest is computed and every authority-critical file is present and
  regular". INV-025 keeps "evidence is bound to what it describes": the report
  still names its digest and is still invalid the moment the tree moves; it is
  simply never committed.
- Historical records (`FINAL_CONTRACT_CLOSURE.json`, `FINAL_FINDINGS.md`,
  qualification and release-plan documents, GMP reports) describe the procedure in
  force when they were written and are not rewritten.
