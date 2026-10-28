# ADR-063: Virtual member locator collision handling

## Status

Accepted

Amends [ADR-036](036-read-only-local-source-acquisition.md).

## Date

2026-10-28

## Context

ADR-036 Decision 3 identifies an archive member by `<archive-path>!/<member-path>`, and
nested archives compose (`Bundle.zip!/inner.zip!/guide.md`).
`docs/architecture-authority.json` publishes the same `member_locator_format`. Neither
states an injectivity rule, and the format alone cannot guarantee one: the separator
`!/` is legal in filesystem names and in ZIP member names, and it is neither escaped
when a locator is formed nor reserved when a name is admitted (RC-045; F-050).

- `src/local_source.ts` forms a member locator by concatenation
  (`` `${task.sourcePath}${ARCHIVE_MEMBER_SEPARATOR}${member.canonicalPath}` ``), and
  `buildRecords` merged physical and member records with no uniqueness check.
- A physical directory `a.zip!/` holding `m.txt` beside an `a.zip` holding `m.txt`
  produced two records at `a.zip!/m.txt` with one inventory id. A ZIP holding a nested
  `in.zip` (with `y.txt`) and a member literally named `in.zip!/y.txt` produced two
  virtual members at `outer.zip!/in.zip!/y.txt`.
- `src/repository_model.ts` derives `artifact_id` from `source_path` and its validator
  requires strictly increasing `source_path` (`stable-ordering`), so the producer
  emitted a packet its own validator refused.
- `archiveAncestryOf` in `src/local_source_model.ts` (semantic projection) and in
  `src/corpus_scan.ts` (readiness `archive_id`, document and semantic ancestry) split
  every path on `!/`. A benign physical `notes!/x.md` was given archive ancestry
  `["notes"]`, and the members of a physical `Wow!/b.zip` were placed in two archives.

## Options Considered

### Option A: Escape `!` and `%` in every path component

- Pros: fully injective; nothing is held.
- Cons: changes `relative_path` and `artifact_id` for every existing file whose name
  contains `!` or `%` (identity churn in corpus snapshots and diffs), changes the
  published `member_locator_format` and every consumer's parser, and needs migration
  notes and an authority change.

### Option B: Keep the format, hold archives that would mint an ambiguous locator

- Pros: no identity changes for any source that did not already collide; golden
  bundles unchanged; ancestry is fixed for physical names at the same time.
- Cons: a rare benign archive containing a folder named like `Wow!` is held rather than
  expanded (members unclaimed, archive still hashed and diagnosed).

### Option C: Detect collisions only and block the canonical packet

- Pros: smallest change.
- Cons: one odd directory name blocks the whole packet, and ancestry misparsing of
  physical names remains.

## Decision

The owner chose **Option B**, with a new hold code rather than overloading
`archive.path_conflict`, whose documented meaning is a file/directory clash inside one
archive.

1. **Member paths.** Local-source acquisition holds an archive whose accepted member
   list contains a canonical member path with `!/`. The member is named in the hold.
2. **Physical siblings.** Acquisition holds an archive `X` when the physical snapshot
   contains any entry whose relative path starts with `X!/` (a sibling directory `X!`),
   because expanding it would mint locators a physical path already spells.
3. **Hold code.** Both holds use the new `ArchiveHoldCode` member
   `archive.locator_ambiguous`. They are applied in `src/local_source.ts` after
   preflight and the archive-manifest cache lookup, so the shared preflight
   (`preflightArchive`, used by the local-files path) and the cached verdict, which are
   properties of the archive's bytes, are untouched. A held archive is still hashed and
   reported (ADR-036 Decision 5).
4. **Invariant.** `buildRecords` fails closed when two records still share a
   `relative_path`: that can only be a producer bug, and the existing acquisition catch
   disposes the scratch root.
5. **Ancestry.** Archive ancestry is derived from the observation's parent chain
   (member `parentArchivePath`, then each archive's `parentArchivePath`) by
   `memberArchiveAncestry` in `src/local_source.ts`, consumed by the semantic projection
   in `src/local_source_model.ts` and by readiness, document and semantic inputs in
   `src/corpus_scan.ts`. A path that is not an archive member has no ancestry.

## Consequences

- **Format unchanged.** `member_locator_format` and every locator of a non-colliding
  source are unchanged; the golden local-source bundle is byte-identical.
- **Newly held archives.** Archives that previously expanded into colliding locators,
  and archives whose member names contain `!/`, are held with
  `archive.locator_ambiguous`; their members are no longer claimed.
- **Public type.** `ArchiveHoldCode` (advanced export) gains
  `archive.locator_ambiguous`, an additive change. `LocalSourceObservation.archives[].holds`
  may carry it. `preflightArchive` never returns it.
- **Ancestry corrections.** Physical names containing `!/` keep their paths but lose the
  bogus archive ancestry in the semantic projection, the document index and readiness
  (`archive_id` is null for them). Members of an archive under such a directory have
  exactly one enclosing archive.
- **Out of scope.** The legacy materialization path (`src/archives.ts`) mints no
  locators and is unchanged. `src/corpus_candidates.ts` still treats a trailing `!` as
  a container boundary for physical directories; that belongs to RC-073/RC-078.
  `src/corpus_intelligence_input.ts` splits container paths on the separator and is
  not changed here.
