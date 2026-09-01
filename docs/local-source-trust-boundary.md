# Local-source trust boundary

Authority: [ADR-036](decisions/036-read-only-local-source-acquisition.md). This
document states what canonical local-source observation trusts, what it refuses, and
where the boundary sits. It describes `src/local_source.ts` and the modules it
composes, not the legacy materialization path in `src/archives.ts`.

## What is untrusted

Everything about the source. A local source is arbitrary input from a drive, a synced
folder, a download, or someone else's export:

| Input | Why it is untrusted |
|---|---|
| Directory entries | Names can collide, entries can be symlinks, devices, sockets or FIFOs |
| File bytes | Any encoding, any size, including files that change mid-read |
| Archive bytes | Structurally malformed, truncated, or deliberately hostile |
| Archive member paths | Traversal, absolute, drive-absolute, UNC, embedded NUL, colliding |
| Archive member metadata | Declared sizes and entry types may be lies |
| A directory named `*.l9extracted` | May be user data that merely shares the name |

Nothing about a source is treated as a permission. In particular, a pathname is never
evidence of ownership.

## What the boundary guarantees

**The source is not modified.** No write, rename, removal, or mode change occurs under
the observed root, on the success path or on any failure path — preflight failure,
extraction failure, interpretation failure, and packet-validation failure all leave the
source byte-identical. The only artifacts a run produces are the ones the operator
asked for by naming an output directory. Tests assert this by comparing a byte-level
snapshot of the tree before and after, not by checking that a particular file survived.

**Deletion is confined and proven.** Recursive removal is permitted only for a path
inside a scratch root this session created, and only after re-reading an ownership
token that root still carries. There is no code path that removes a directory because
of its name.

**Archives are read, not executed.** No subprocess participates. `src/zip_reader.ts`
parses the central directory and streams members through Node's zlib under an explicit
output ceiling. Extraction targets tool-owned scratch outside the source tree, so a
member path that escapes its virtual root has nowhere to escape to even if a rule were
missed — and the rules are checked first.

**Preflight decides before any byte is written.** `src/archive_preflight.ts` judges the
complete central directory. A member is refused for an absolute, drive-absolute, UNC,
traversing, NUL-bearing, over-long, or root-escaping path; for being a symlink, device,
socket or FIFO; for being encrypted; for using an unsupported compression method; for
duplicating another member exactly; or for colliding with another member after Unicode
NFC normalization and a deterministic case fold. Collisions are computed from Unicode
rules rather than from host filesystem behavior, so an archive is judged identically on
a case-sensitive and a case-insensitive machine.

**A violation holds the whole archive.** Expanding the safe half of a hostile archive
would present a partial view a consumer cannot distinguish from a complete one. A held
archive keeps its observation and its digest, records its reason, and contributes no
members.

**Expansion is bounded twice.** `LocalArchivePolicy` caps archive size, member count,
per-member, per-archive and per-session uncompressed bytes, compression ratio, nesting
depth, path length and processing time. The declared sizes in the central directory are
checked first; the bytes actually produced are checked again during extraction, because
the first check trusts the archive's own account of itself. A member that understates
its size in metadata is still cut off at the ceiling.

**Symlinks are not followed.** A link is recorded with its literal target text; the
target's bytes are never read. This holds for links pointing outside the root, links
forming cycles, and links inside archives (which are refused outright).

**Decoding is gated on the whole file.** `src/encoding.ts` validates every byte as
UTF-8 in bounded memory before any decode or mutation. An extension selects a metadata
carrier; it never grants eligibility. A file that fails is hashed, diagnosed, and left
alone.

**Secret-candidate paths are not opened.** The refusal applies to virtual member paths
exactly as to ordinary ones: `Bundle.zip!/.env` keeps its path, size and digest, and
contributes no excerpt and no assertion. The acquisition manifest carries paths,
digests and counts, never file content.

**A torn snapshot is refused.** Entries are enumerated, hashed, then re-enumerated. If
the entry set moved, or a file changed across its own hash after a bounded retry, the
observation is unstable and no canonical packet is produced.

## What crosses the boundary

Only derived facts, all machine-independent:

- Repository-relative POSIX paths and virtual member locators (`Bundle.zip!/docs/a.md`)
- SHA-256 digests of exact bytes
- Entry kinds, sizes, and literal symlink target text
- Deterministic classifications and diagnostics
- Bounded, secret-screened evidence excerpts from files that were eligible to read

Absolute paths, scratch locations, inode and device numbers, access and modification
times, observation wall clock, usernames and hostnames never cross it.

## Known limits

- **ZIP only, in v1.** `tar`, `tgz`, `gz`, `bz2`, `xz`, `7z`, `rar`, `jar`, `war` and
  similar are classified as archives, hashed, and reported with
  `archive.format_not_expanded`. No external tool is consulted to guess at them.
- **Member name encoding.** A member name stored without the UTF-8 flag is decoded as
  UTF-8 and flagged when that is lossy. Historical CP437 names are not transcoded.
- **Time-of-check to time-of-use on the source root.** The archive is hashed and read
  from a staged immutable copy, so hashing and parsing agree. The staging read itself
  is a single pass over the live file; a source rewritten during that pass is caught by
  the stability check, not prevented.
- **Resource limits are policy, not isolation.** They bound this process's work. They
  are not a sandbox, and they do not bound what a consumer later does with the packet.
- **The legacy path is different.** `PipelineConfig.localFiles` materializes into the
  source tree by design. Since ADR-045 it is hardened further: materialization goes
  through a same-directory candidate with an atomic swap, destructive replace
  requires the exact v2 ownership marker (`l9-meta-injector.local-files-extraction/v2`,
  exact owner id — never a prefix match), an empty unmarked or legacy v1-marked
  target is refused as user data, and dry-run runs the same admission as a real
  run. It is still not covered by the read-only guarantees above. Use
  `local-source` for anything you do not intend to modify.

## The cache is inside the boundary, not outside it

The content-addressed cache holds decoded text from the documents being observed,
so it is treated as material of the same sensitivity as the source: its
directories are created `0700` and its entries `0600`, it is refused inside any
observed root (resolved through `realpath`, so a symlink cannot walk through the
check), and documents whose path looks like a credential are never decoded and so
never reach it. No document content is written to a log.

A cached hash is not a fresh observation. `--incremental` may carry a previous
run's content hash forward on a size and mtime match, and a snapshot that did so
is labelled `cached_unchanged_assumption` rather than `fully_verified`. No
performance optimization is permitted to upgrade a weaker evidence class into
byte verification; see [`corpus-cache.md`](corpus-cache.md) and
[`corpus-scale-operation.md`](corpus-scale-operation.md).
