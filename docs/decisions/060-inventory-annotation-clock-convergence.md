# ADR-060: Inventory annotation clock convergence

## Status

Accepted

Amends [ADR-049](049-inventory-archive-member-annotation.md) item 6: the three
clocks are still emitted on every carrier, and `InventoryRecord` still holds the
filesystem observation, but the `created_at` / `modified_at` a carrier holds are
no longer re-read from the filesystem after the tool's own previous write.

## Date

2026-10-28

## Context

INV-003 requires an identical re-run to be idempotent. A live inventory with an
identical `now` never reached a fixed point (RC-050, finding F-006):

- `buildRecord` takes `modified_at` from `lstat` mtime and `created_at` from the
  filesystem birthtime (`src/inventory.ts` `buildRecord`, `filesystemCreatedAt`),
  and `annotationFields` stamped both into the header. The atomic replace that
  wrote the header gave the file a new mtime and a new inode (and so, on a
  filesystem with real birthtimes, a new `created_at`). The next run stamped
  those, rewrote the file, and moved them again. The header described the tool's
  previous write, not the artifact.
- `writeInjection` (`src/inject.ts`) replaced the target even when the rendered
  bytes equalled the file, and `writeSidecar` / `writeFolderSidecar` replaced
  sidecars unconditionally.
- `annotationFields` spread harvested keys before the keys it sets itself, so a
  harvested `title`, `id` or clock pinned its position and `content_hash` (which
  the harvest sanitizer removes) moved to the end: one extra rewrite after the
  first annotation.
- A folder sidecar's clocks are the directory's, and every staged rename inside
  the directory moves its mtime.

The archive member path already avoided the loop: `annotateArchive` compares the
member with `content_hash`, `modified_at` and `created_at` removed before
rewriting it.

The same unit also closes two adjacent gaps in the same writers. RC-051 (F-007):
`writeSidecar` replaced an existing `<file>.l9meta.yaml` with no check, so a
hand-authored sidecar the canonical parser cannot read, or one with comments or
an unfenced layout, was silently replaced by derived fields, while the folder
writer already held such a file. RC-056 (F-057): a filesystem error while
rewriting an archive member, or a directory standing where a folder sidecar
belongs, threw out of `inventoryTree` after earlier entries were annotated, so no
manifest was written.

## Options Considered

### Option A: Restore the pre-write mtime after each annotation write

- Pros: the header equals the filesystem mtime and re-runs converge.
- Cons: hides the tool's own mutation from mtime-driven backup and sync tools;
  cannot restore a birthtime; contradicts the module's "annotation IS A MUTATION"
  stance.

### Option B: Skip a carrier rewrite when only the clock fields differ

- Pros: converges for an identical `now`; already the archive-member precedent.
- Cons: whenever `now` changes, the written clocks are again the tool's previous
  write time and birthtime; an original birthtime is lost after the first
  annotation on APFS.

### Option C: Carry harvested clocks while the carrier-free content is unchanged

- Pros: converges on run 2; clocks describe the artifact's last content change;
  the original birthtime survives annotation.
- Cons: carrier clocks may differ from the `inventory.json` observation after an
  annotation; a metadata-only or touch-only change does not move `modified_at`.

## Decision

The owner chose **Option C, with Option B's clock-only skip for folder sidecars
and a same-byte write skip in every writer** (DEC-RC-050).

1. **Carry rule.** For a regular file with a known `content_hash`, when the
   harvested content hash equals the hash just computed, each harvested clock is
   carried into the carrier if it is a complete ISO-8601 instant — or, for
   `created_at`, exactly `Unknown`. Otherwise the `lstat` observation is written.
   The harvested hash is the carrier's `content_hash`; on the `--schema` path it
   is the schema field whose `source` is `content_hash`, and a schema with no
   such field has no anchor, so its clocks are observed. The post-injection clock
   patch (`applyInventoryClocksToWritten`) writes the same values.
2. **The record stays an observation.** `InventoryRecord.created_at` /
   `modified_at` in `inventory.json` and `inventory.csv`, the schema-shaped
   `meta` on the record, and `clock_skew:*` diagnostics keep using `lstat`
   (ADR-051 item 6 is unchanged).
3. **Harvest-independent key order.** `annotationFields` removes harvested copies
   of every key it sets after the harvest spread (`id`, `title`, `source_path`,
   `content_hash`, `inventory_type`, `classification_confidence`, and the three
   clocks); the operator `title` is read from the sanitized harvest first.
4. **No same-byte replace.** `writeInjection`, `writeSidecar` and
   `writeFolderSidecar` do not replace a target whose bytes already equal the
   rendering. `injectFile` / `injectFileAsync` keep their signature and their
   returned `InjectionRecord`; an unchanged target simply keeps its inode, mtime
   and hard links.
5. **Folder sidecars** have no content anchor. A tool-format folder sidecar that
   differs from the derived one only in `created_at` / `modified_at` is kept.
6. **One preservation predicate for `.l9meta.yaml` carriers.** File and folder
   sidecars share one check: an existing regular file is replaced only when the
   canonical parser reads it and re-serializing it reproduces its bytes. A file
   the parser rejects is held with `sidecar_unreadable` (folder:
   `folder_sidecar_unreadable`); one that would not round-trip is held with
   `sidecar_lossy_roundtrip` (folder: `folder_sidecar_lossy_roundtrip`); a read
   failure is held with `sidecar_read_failed:<errno>` (folder:
   `folder_sidecar_read_failed:<errno>`). A directory or link at the path goes on
   to the write, whose refusal is recorded as `sidecar_write_failed:*`.
7. **Archive rewrite I/O is a hold.** A read or replace failure inside
   `upsertArchiveRootMeta` returns the existing hold result
   `archive.rewrite_io_failed:<errno>`, recorded as
   `archive_rewrite_held:archive.rewrite_io_failed:<errno>`. The walk continues and
   the manifests are written.

## Consequences

- Two consecutive live inventories with the same `now` leave every inline header,
  file sidecar and folder sidecar byte-identical, with inode and mtime unchanged.
- A new `now` still rewrites every carrier once, because `inspected_at` changes
  (the ADR-049 consequence). File clocks no longer drift to the tool's previous
  write; folder clocks, having no anchor, take the directory's current clocks on
  such a rewrite.
- A body edit changes `content_hash` and sets `modified_at` to the edit's mtime.
  A `touch` or a change to the carrier alone does not move `modified_at`.
- After annotation the carrier's clocks and the `inventory.json` observation can
  differ; the record describes the filesystem, the carrier describes the artifact.
- Migration: an already annotated tree may be rewritten once (new key order).
  A carrier already holding a tool-write mtime keeps it until the body changes,
  so "last content change" is exact only from the first post-change edit.
- User sidecars in a non-canonical layout (comments, no fences, nested maps) are
  now held with a diagnostic instead of reformatted. Add fences and drop comments
  to let inventory maintain them again.
- Runs that previously threw on an archive rewrite or folder-sidecar I/O error now
  return with the failure on the affected record.
- Record diagnostics gain free-form codes (`sidecar_unreadable`,
  `sidecar_lossy_roundtrip`, `sidecar_read_failed:*`,
  `folder_sidecar_read_failed:*`, `archive.rewrite_io_failed:*`); the record
  shape and the public API are unchanged.
- Validation: the APFS birthtime behaviour (created_at stable across runs and
  equal to the pre-annotation birthtime) is simulated on Linux in the test suite
  and must be confirmed on macOS before release.
