# Migration: `--local-files` materialization to `local-source` observation

Authority: [ADR-036](../decisions/036-read-only-local-source-acquisition.md).

Two behaviors changed for existing callers, and one new surface replaces the old one
for observation. Nothing was removed.

## If you were using `--local-files` to look at a drive

Switch to `local-source`. It is the observation path, and it does not modify the tree.

```bash
# Before: mutates the source. Extracts beside each archive and injects members in place.
npm run pipeline -- /Volumes/Data/Folder --local-files

# After: read-only. Emits a packet bundle and an acquisition manifest.
npm run local-source -- /Volumes/Data/Folder --name Folder --out ./out
```

What changes in what you get back:

| Before | After |
|---|---|
| `Foo.l9extracted/docs/a.md` on disk | virtual artifact `Foo.zip!/docs/a.md`, nothing on disk |
| `<zip>.l9meta.yaml` beside the archive | `<out>/local-source-manifest.json`, never in the source |
| member identity tied to the extraction directory | member identity from archive digest + member path + member bytes |
| archive membership implicit in the path | explicit `DERIVED_FROM` relationship in the packet |
| requires system `unzip` | no subprocess, no dependency |
| unbounded expansion | `LocalArchivePolicy` caps, enforced twice |
| a Git repository was assumed | any file, folder, drive tree, or ZIP; no Git needed |

The source does not need a `.git` directory, and a single file or a standalone `.zip`
is a valid source.

## If you depend on `--local-files` materialization

It still works, and it still writes into your tree. Two behaviors changed:

**Dry run no longer extracts.** It previously wrote the extraction directory and
skipped only the sidecar. If you relied on `dryRun: true` to populate
`*.l9extracted/`, you were relying on a bug; drop the flag to materialize.
`ArchiveRecord.heldReason` now reports what a real run would extract.

**Extraction refuses an unowned target.** If `Foo.l9extracted/` already exists and does
not carry a `.l9extracted-owner.json` marker written by this tool, the archive is held
with a reason instead of the directory being deleted. Directories this tool created are
refreshed as before, so a repeated run on its own output is unaffected. To re-extract
over a directory you created yourself, remove it deliberately first.

Programmatic callers should check `heldReason`:

```ts
const result = expandArchivesUnderRoot(root, { dryRun: false, verbose: false });
for (const archive of result.archives) {
  if (archive.heldReason !== undefined) {
    // Observed and reported, deliberately not expanded.
  }
}
```

## If you depend on discovery accepting any known-text file

Discovery now reads a candidate before declaring it eligible. A readable UTF-8 file is
unaffected. A file that is binary, not valid UTF-8 over its whole length, or unreadable
is excluded with an explicit disposition (`binary_detected`, `unsupported_encoding`,
`unreadable`) rather than being injected into.

This is the fix for a real defect: a `.md` file whose first 8 KiB were ASCII and whose
tail was Windows-1252 used to be eligible for inline injection, which decodes and
rewrites the whole file and loses the tail. If such a file was previously being
"processed", it was being corrupted.

## Packet identity

Packets built from a Git checkout are unchanged: they keep the
`meta-injector-inventory-observation` profile, and existing golden bundles still match.
Local-source packets declare `meta-injector-local-source-observation` and use a
`file:`/`archive:`/`fs:sha256:` source revision instead of `git:<sha>`.
