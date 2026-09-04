# ADR-046: One archive-format authority, order-independent path conflicts, and byte-faithful direct mutation

## Status

Accepted

## Date

2026-09-02

## Context

A filesystem and tarball forensic audit of the ingestion and mutation seam ran the
canonical observation path, the opt-in `localFiles` materialization path, pipeline
injection, and inventory annotation against realistic and adversarial local corpora.
It confirmed the following defects at code depth.

**A path could be a file and a directory.** A ZIP declaring `a` as a file and `a/b`
as a file passed preflight — the exact-duplicate and fold-collision rules see two
distinct paths — and the verdict then depended on central-directory order. With `a/b`
first, the archive was held as `archive.format_unreadable`, which is a claim about
the bytes that was false. With `a` first, `mkdir` threw `EEXIST` out of member
staging, the whole acquisition failed, and the scratch root with every staged member
was left behind. The same archive threw out of `localFiles` materialization.

**Three modules decided what an archive is.** The strategy resolver's binary set, the
inventory classifier's archive set and the acquirer's "known but not expanded" set
disagreed: `.zst`, `.lz4`, `.cab`, `.iso` were diagnosed as archives by acquisition and
classified `unknown` by the inventory record of the same file, so a manifest and the
diagnostic about it told two stories. The reader version was also declared twice.

**Unsupported content could be silent.** A tarball named `.tar`, `.tgz` and so on
received an explicit `archive.format_not_expanded`; an extensionless tarball or a gzip
stream saved as `notes.txt` was an ordinary binary document with no disposition.

**Direct mutation was not byte-faithful.** Comment injection joined the block with LF
and prepended it to the body, so a CRLF file came back mixed and a byte-order mark was
pushed into the middle of the file. A second run on a CRLF file read the block's values
back with a trailing carriage return.

**Direct mutation was not crash-safe and wrote through hard links.** The injector, the
adjacent sidecars and the archive sidecar opened the target itself for writing: a
truncate followed by a write, with no backup, and through the existing inode. A crash
mid-write left a truncated source; injecting into a file hard-linked from outside the
governed root rewrote the outside file too. The governed `apply` operation was already
transactional (ADR-027); the direct paths were not.

**A refused `localFiles` run had already mutated the tree.** The pipeline materialized
every archive and wrote its sidecars before discovery found the symlink that made the run
refuse, so a run that reported doing nothing had created `*.l9extracted/` directories.

**A run's output could be its next input.** `inventoryTree` refused an output directory
equal to the root and omitted one nested inside it; the pipeline did neither, and a
second run over a root holding its own `out/` annotated the previous run's reports and
wrote sidecars beside them.

**Ordering was locale-dependent.** Transaction intents, journal recovery order,
discovery ledgers, carrier decisions, authority-scan results and skills intents sorted
with `localeCompare`, in a package whose `src/ordering.ts` states that every ordering a
machine compares must be code-point. The inventory walk and the nested-archive walk
used raw `readdir` order, so which nested archive an exhausted session budget held
depended on the host filesystem, and an inventory manifest's record order did too.

**Symlinks and special entries vanished from the inventory.** The inventory walk kept
only `isFile()` and `isDirectory()` entries, so a symlink, FIFO or socket disappeared
without a disposition, while the same entry was recorded by canonical observation.

**The committed validation report described another tree.** `npm run validate` failed
on a clean checkout of `main` because `CURRENT_VALIDATION_REPORT.md` was bound to the
tree digest of an earlier commit; the CI smoke job on the head of `main` was red.

## Decision

1. **`src/archive_formats.ts` is the archive-format authority.** It owns the
   expandable set (ZIP), the recognized-but-never-opened set (every TAR and compressed
   tarball spelling, plus `gz`, `bz2`, `xz`, `zst`, `lz4`, `7z`, `rar`, `jar`, `war`,
   `cab`, `iso`), and a bounded byte-signature probe. The strategy resolver, the
   inventory classifier, the acquirer and the legacy expander consume it and add nothing.
   The reader version is declared once, in `archive_execution.ts`, and re-exported.

2. **A signature is reported, never acted on.** A file whose leading bytes carry an
   archive signature its name does not declare gains `archive_signature:<format>` on its
   record and a `local-source.archive_signature_detected` diagnostic. Nothing is opened
   on the strength of magic bytes; a ZIP container that is a document by format
   (`.docx` and its relatives) is not reported. TAR remains outside v1: there is no TAR
   reader, and every tarball spelling and every hostile TAR shape receives the same
   explicit disposition, proven by an executable rejection matrix.

3. **Preflight refuses file/directory path conflicts and over-long components.** A
   canonical path declared as a file by one member and used as a directory by another
   holds the archive with `archive.path_conflict`, judged once after the whole directory
   is known, so both orders receive the same verdict before any byte is written. A
   component longer than 255 UTF-8 bytes is `archive.path_too_long`. The reader version
   moves to `1.1.0`, so a warm 1.0.0 verdict is never consulted for the new rules.

4. **A host failure is thrown, not held, and the scratch root never survives it.**
   Only `ZipFormatError` and budget errors become holds during member staging; any
   other error propagates, and acquisition disposes its scratch root on the way out.

5. **Direct mutation stages beside the target and renames it in.**
   `replaceFileAtomically` in `durable_write.ts` writes a dotted sibling, syncs it,
   renames it over the target and syncs the directory; an existing target keeps its
   permission bits, a symlink or non-regular target is refused, and the rename gives the
   name a fresh inode so a hard link elsewhere keeps its bytes. The injector, its inject
   log, both inventory sidecars and the archive sidecar use it. The governed `apply`
   transaction is unchanged.

6. **Comment injection adopts the file's conventions.** The block uses the newline the
   body already uses, sits after any byte-order mark, keeps a shebang on line 1, and is
   read back on either convention.

7. **The pipeline refuses an output directory equal to the root and omits one inside it**,
   as `inventoryTree` already did. A real `localFiles` run also judges discovery before
   it materializes: a tree with a blocking entry is refused with nothing extracted and no
   sidecar written, instead of half-mutated and then refused.

8. **The seam sorts by code point.** Every `localeCompare` on the filesystem, discovery,
   transaction, carrier and authority paths is `compareCodePoints`; the inventory walk
   and the nested-archive walk sort directory entries the same way. A static test holds
   `src/` to it.

9. **The inventory records every entry it meets.** A symlink or special entry becomes a
   record with `artifact_type: unknown`, no hash, and `symlink_not_traversed` or
   `special_filesystem_entry`; it is never opened and never annotated.

10. **The validation report is regenerated on the tree it describes**, as part of this
    change, restoring a green `npm run validate` on a clean checkout.

## Consequences

- An archive accepted under reader 1.0.0 may be held under 1.1.0 when it carries a
  file/directory conflict; that archive could never have been materialized faithfully.
- Records for files that carry an undeclared archive signature, for `.zst`/`.lz4`/
  `.cab`/`.iso` files, and for symlinks and special entries in inventory mode change
  shape; packet identities for corpora containing them move once.
- A source file on the direct-mutation paths is either its old bytes or its complete
  new bytes; a crash leaves at most a dotted staging file beside it.
- Orderings that reach a journal, a ledger, a manifest or a report are the same on every
  host and locale.
- TAR support is still not claimed. Adding a TAR reader is a separate decision that
  would have to bring its own preflight vocabulary, link and special-entry policy,
  sparse and PAX handling, and fixture matrix.
