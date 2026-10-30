# ADR-072: Nested authority discovery exclusions

## Status

Accepted

## Date

2026-10-28

## Context

[ADR-047](047-one-glob-dialect-and-fail-closed-repository-modes.md) item 7 states that
every `.l9/meta-authority.yaml` below the root is a `META_AUTHORITY_CONFLICT` naming its
path. [ADR-020](020-fail-closed-repository-authority-scan.md) item 5 separately excludes
documentation, tests, fixtures, reports, generated output, dependencies and VCS
internals from *active-writer conclusions*.

The code collapsed the two. `walkFiles` in `src/authority_scan.ts` tested
`DEFAULT_EXCLUDED_DIRECTORIES` (`docs`, `test`, `tests`, `fixture`, `fixtures`,
`reports`, `build`, `dist`, `coverage`, `node_modules`, `.venv`, `.git`,
`__pycache__`) before the nested-authority probe, so an excluded name was never
descended at any depth, and the probe accepted only an `lstat`-regular document
(RC-030, finding F-039). `docs/handbook/.l9/meta-authority.yaml`,
`tests/e2e/.l9/meta-authority.yaml`, `src/build/.l9/meta-authority.yaml` and any
symlinked nested document all resolved silently, contrary to ADR-047 item 7.

In the same walk, a symbolic link was judged with the file predicate `isCandidate`,
whose slash-terminated `CONTROL_PREFIXES` never match a directory path, so a symlinked
`.github`, `.github/workflows`, `scripts`, `.husky` or `.githooks` was skipped without a
scan gap (RC-027, finding F-036).

Taken literally, ADR-047 item 7 would also walk `.git` and every installed dependency
tree, which the repository does not author. The code and the ADR had to agree on which
directories, if any, stay skipped.

## Options Considered

### Option A: Search literally every directory below the root

- Pros: exact ADR-047 wording.
- Cons: walks `.git` and whole dependency trees on every check; blocks any consumer
  whose installed dependency ships an `.l9` document it does not control; `.git`
  internals never contain one in practice.

### Option B: Search every directory except VCS internals and dependency install trees

- Pros: covers `docs`, `tests`, `fixtures`, `build`, `dist`, `coverage` and `reports`
  as ADR-047 intends; bounded cost; the exclusion is explicit and recorded.
- Cons: a nested declaration inside `node_modules`, `.venv`, `__pycache__` or `.git`
  is not reported.

### Option C: Keep the writer-evidence exclusions, add symlink detection only

- Pros: smallest change.
- Cons: leaves the reported defect in place; contradicts ADR-047 item 7.

## Decision

The owner adopted **Option B**.

1. Writer-evidence exclusions — `DEFAULT_EXCLUDED_DIRECTORIES` plus a caller's
   `excludedDirectoryNames` — govern candidate control-surface collection only. They
   are still descended in a nested-authority-only mode that collects no candidate
   files and records no writer evidence, so ADR-020 item 5 is unchanged.
2. Nested-authority discovery skips exactly `NESTED_AUTHORITY_SKIPPED_DIRECTORIES`:
   `.git`, `node_modules`, `.venv` and `__pycache__`, at any depth.
3. Any entry that `lstat` finds at a nested `.l9/meta-authority.yaml` — a regular file,
   a symlink (dangling or not), or another entry type — is a `META_AUTHORITY_CONFLICT`
   naming its path, in code-point order.
4. A nested `.l9` that is itself a symlink is a `META_AUTHORITY_SCAN_INCOMPLETE` gap
   naming the link: its content cannot be inspected without following it, and the
   scanner never follows links. A nested `.l9` directory without a document still
   competes with nothing.
5. A symbolic link whose repository-relative path is a control file, a control
   directory (a `CONTROL_PREFIXES` entry without its trailing slash), or a strict
   ancestor of one (`.github`) is a `META_AUTHORITY_SCAN_INCOMPLETE` gap naming the
   link (DEC-RC-027, option A). The test is derived from `CONTROL_PREFIXES` and compares
   whole path segments, so `bin2` or `scriptsx` never match. A non-control link such as
   `assets -> ../shared` stays quiet; a suspiciously named writer script behind a
   generic directory link remains unscanned and is a residual for a separate decision.
6. Walk gaps are reported in code-point order of their paths.

This amends [ADR-047](047-one-glob-dialect-and-fail-closed-repository-modes.md) item 7
(which directories "below the root" means) and clarifies
[ADR-020](020-fail-closed-repository-authority-scan.md) item 5 (its exclusions apply to
writer evidence, not to nested authority).

## Consequences

- Repositories carrying a nested authority document under `docs`, `tests`, `fixtures`,
  `build`, `dist`, `coverage`, `reports` or a caller-excluded directory — including
  copied fixture repositories — now fail `check`, `apply` and non-dry-run `skills`
  until the declaration is removed or relocated. `inventory` still reports without
  blocking (ADR-020 item 7).
- Repositories that symlink a control directory (for example `.husky -> ../shared/hooks`)
  now fail the governed modes until the link is replaced by a real directory, matching
  the existing behaviour for a symlinked control file.
- An unreadable directory inside a previously skipped subtree now surfaces as a scan
  gap (consistent with ADR-047 item 6).
- The walk reads directory listings of the newly descended trees; no file content is
  read there.
- No API, file-format or option change. `authority_scan` symbols are not public API.
- This repository has no nested `.l9` and is unaffected.
