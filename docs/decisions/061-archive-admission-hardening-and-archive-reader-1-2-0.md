# ADR-061: Archive admission hardening and archive reader 1.2.0

## Status

Accepted

Amends [ADR-046](046-archive-format-authority-and-fidelity-of-direct-mutation.md).

## Date

2026-10-28

## Context

The remediation audit of `bf66978` confirmed three defects in ZIP admission, all owned
by the canonical reader (`src/zip_reader.ts`) and preflight (`src/archive_preflight.ts`)
that ADR-044 and ADR-046 made the single ZIP authority.

**Declared sizes were trusted (RC-038; F-044, F-045).** `readCentralEntry` never
bounded `localHeaderOffset` or `compressedSize` against the archive, and
`readDeflatedMember` passed `compressedSize` to `Buffer.alloc`. A member declaring a
Zip64 compressed size of 2^40 raised `RangeError: Array buffer allocation failed`,
which no hold classifier recognizes (`src/archives.ts` `expectedArchiveHoldReason`,
`src/local_source.ts` `stageOneMember`), so one hostile ZIP aborted
`expandArchivesUnderRoot` and `acquireLocalSource` for every archive after it. ADR-046's
Context names exactly that class of failure ("the whole acquisition failed"), and
`src/archive_execution.ts` allows only host and tool failures to throw.
Separately, `streamZipMember` returned the bytes it produced without comparing them to
the declared `uncompressedSize`. The ratio and total rules in preflight are evaluated
on declared sizes, so a member declaring 1 byte that inflated to 8 MiB passed a
`maxCompressionRatio` of 10, and a member declaring 1000 bytes that produced 11 was
accepted silently. `src/local_archive_policy.ts` documents that limits are checked
twice, "again against bytes actually produced, because metadata may lie"; the second
check did not exist for the ratio.

**The file/directory conflict rule used exact paths (RC-040; F-047).**
`notePathUsage` and `pathConflictHolds` keyed file and directory usage by the exact
canonical path, while the collision rule keys by `memberCollisionKey` (NFC plus case
fold). `Docs` as a file beside `docs/readme.txt`, or an NFC `café` file beside an NFD
`café/` directory, passed preflight; on a case- or normalization-insensitive
filesystem materialization then threw `EEXIST`/`ENOTDIR`, a host failure ADR-046
Decision 4 rightly refuses to reclassify, and the run aborted. The preflight header's
promise that "the same archive is judged identically on a case-sensitive and a
case-insensitive machine" did not hold.

**A Unix mode without type bits was "unknown" (RC-041; F-048).** `entryKindFor`
trusted a Unix-host mode whenever it was non-zero. CPython's `zipfile.writestr`
records `0o600` (no `S_IFMT` bits), which fell to `unknown` and held the whole archive
with `archive.entry_kind_unknown` on all three archive paths, although Info-ZIP and
Python both extract it as a regular file.

The bounded-inflation question raised alongside these (DEC-GAR-06) was whether each
decoder bounds zlib itself or shares one internal helper. The pdf, OOXML, inventory
gunzip and tar sites already landed their own bounds in WU-057, WU-061 and WU-077; the
ZIP reader's inflate stays in the reader that owns ZIP admission, is not exported, and
adds no dependency.

## Options Considered

The open choice was DEC-RC-038: which hold class a produced-versus-declared size
mismatch receives, and whether the reader version moves.

### Option 1: A `ZipFormatError` subclass, refined to the integrity codes

- Pros: every classifier that already holds a `ZipFormatError` holds it fail-closed
  with no change; the classifiers that know integrity (`local_source`, `archives`)
  refine it to the code a CRC mismatch already receives, which is what it is: the
  bytes contradict the central directory.
- Cons: a hold code observed for some size-lying members changes.

### Option 2: Plain `ZipFormatError` reported as `archive.format_unreadable`

- Pros: no consumer change.
- Cons: labels a content/metadata contradiction as an unreadable format, the mislabel
  ADR-046's Context criticizes.

### Option 3: Keep `ZipBudgetExceededError` for overflow, add an underflow check only

- Pros: no existing assertion changes.
- Cons: the same lie gets two codes depending on its direction, and "budget exceeded"
  is false when the policy budget was never reached.

## Decision

The owner chose **Option 1**, with the central-directory extent check placed in the
reader as well, under one reader version bump shared with the conflict and kind rules.

1. **Extents.** `readZipCentralDirectory` refuses, as `ZipFormatError`, any entry whose
   data extent (local header offset, the local header's own name and extra lengths,
   and the declared compressed size) does not end at or before the start of the
   central directory. The local header's lengths are read so the bound is exact: an
   honest last member ends exactly at the central directory. Because the check is at
   directory read, extraction, the inventory writer (`src/zip_writer.ts`) and the OOXML
   decoder are all protected before any allocation sized by a declared length.
   `streamZipMember` keeps a backstop for entries supplied directly: a data extent past
   the archive's size (`fstat` of the open descriptor) is refused before reading.
2. **Produced bytes.** Nothing past `min(declared uncompressedSize, caller ceiling)` is
   ever emitted. A member that produces more than it declares while staying inside the
   caller's ceiling, or fewer than it declares, raises `ZipSizeMismatchError`, a
   `ZipFormatError` subclass. `src/local_source.ts` maps it to
   `archive.member_integrity_failed` and `src/archives.ts` to `archive.integrity_failed`;
   every other classifier holds it as a format error. Because produced equals declared
   is now enforced, the preflight ratio, total and per-member rules evaluated on
   declared sizes bound the bytes actually produced.
3. **Path conflicts.** File usage and directory usage (explicit entries and every
   implied ancestor) are keyed by `memberCollisionKey`, the raw name retained for
   reporting. A file and a directory that share a key hold the archive with
   `archive.path_conflict` in both central-directory orders, judged once after the whole
   directory is known. One defect, one hold: a key already reported as an exact
   duplicate or a whole-path fold collision is not reported again as a conflict.
4. **Entry kind.** When a Unix-host mode has no `S_IFMT` bits the name rule decides
   (trailing `/` is a directory, otherwise a file), exactly as on a non-Unix host, and
   `unixMode` still reports the recorded mode. Recognized type bits keep their meaning;
   a non-zero unrecognized type value stays `unknown`.
5. **Reader version.** `ARCHIVE_READER_VERSION` moves from `1.1.0` to `1.2.0`, declared
   once in `src/archive_execution.ts` and re-exported by `src/local_source.ts`.

### Reading of the decision: which bound zlib enforces

The unit packet described the declared size as the bound zlib enforces. Wave 1 had
already landed WU-061 (RC-119), whose accepted regressions require an OOXML part that
lies about its size to be refused exactly like an honest bomb (`decoder.budget_exceeded`)
and to consume its container allowance. Enforcing the declared size inside zlib would
reclassify those parts as `decoder.malformed` and break that contract. The adopted
reading, the smaller consumer-visible change, keeps zlib bounded by the caller's
ceiling and enforces the declared size on what is emitted:

- output that overruns the caller's ceiling is `ZipBudgetExceededError`, whatever the
  member declared, because the policy budget was in fact reached;
- output inside the ceiling but past the declared size, or short of it, is
  `ZipSizeMismatchError`.

This is Option 1's rationale applied literally: a budget code only when the budget was
reached, an integrity code otherwise. The existing test "a declared size that
understates the real expansion is caught at runtime" therefore keeps its
`archive.extracted_bytes_exceeded` assertion (its 256 KiB expansion overruns a
4096-byte ceiling), and memory for a deflated member stays bounded by the policy
ceiling, as before.

## Consequences

- **Verdicts change in both directions.** Archives with an impossible declared extent,
  a size lie, or a folded file/directory conflict are now held; archives written with
  permission-only Unix modes (CPython `zipfile.writestr`) are now expanded, extracted
  and rewritten. A materialized member is always a regular file, so the kind change
  opens no symlink path.
- **Hold codes.** A size-lying member inside the caller's ceiling is held as
  `archive.member_integrity_failed` (local source) or `archive.integrity_failed`
  (local files). An impossible extent is `archive.format_unreadable` on every path,
  including inventory (`archive_rewrite_held:archive.format_unreadable:...`), and the
  OOXML decoder reports it as a malformed container at open.
- **`ZipSizeMismatchError`** is a new export of the internal `src/zip_reader.ts`
  module; the public API contract is unchanged. `preflightArchive` (advanced export)
  changes behaviourally only.
- **Cache epoch.** `ARCHIVE_READER_VERSION` `1.2.0` invalidates every warm top-level
  archive-manifest verdict once (`src/local_source.ts` `preflightStaged`, the corpus
  cache `archive_manifest` layer); a warm `1.1.0` verdict is never replayed. The
  reader version enters no packet or corpus identity.
- **No policy version bump.** `LOCAL_ARCHIVE_POLICY_VERSION` stays `1`: no policy field
  or its meaning changes (the corrections implement the documented "checked twice"
  contract), and the policy version enters every local-source packet identity.
- **Cost.** Directory read performs one 30-byte local-header read per entry.
- **Out of scope.** Host failures during materialization still throw (ADR-046
  Decision 4); two implied directories differing only by case with no file conflict
  stay accepted; overlapping-member detection and the OOXML aggregate budget are not
  changed here.
