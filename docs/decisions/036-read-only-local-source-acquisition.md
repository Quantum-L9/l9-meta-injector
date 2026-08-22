# ADR-036: Canonical local-source and archive observation is read-only and staging-based

- **Status:** Accepted
- **Date:** 2026-08-22
- **Supersedes:** the sibling-`*.l9extracted` materialization model of
  [ADR-016](016-local-files-archive-expansion.md) *for canonical observation only*.
  ADR-016's opt-in `PipelineConfig.localFiles` materialization workflow remains, hardened.
- **Related:** [ADR-030](030-repository-model-packet-egress.md),
  [ADR-032](032-deterministic-repository-interpretation-seam.md)

## Context

The package could already point at a folder, but only under two assumptions that do
not hold for an arbitrary local source: that observing is safe, and that identity can
borrow from a filesystem layout.

Neither held.

**Observation mutated the source.** `expandArchivesUnderRoot` extracted `Foo.zip`
into a sibling `Foo.l9extracted/`, and it removed whatever already occupied that path
first — unconditionally, on the strength of the pathname alone. A user directory that
merely happened to be named `Foo.l9extracted` was destroyed by the act of looking at
the drive next to it. The same path also wrote a `<zip>.l9meta.yaml` sidecar beside
the archive, containing an absolute extraction path and a wall-clock timestamp, which
the next run would then observe as if it were user content.

**Dry run was not dry.** `dryRun` skipped the sidecar write and extracted anyway, so
the mode that exists to promise "nothing will be touched" touched the source tree.

**The extraction directory became identity.** A member's `source_path` was a physical
path under `Foo.l9extracted/`, so the same archive observed on two machines produced
two different artifact identities, and a consumer could not tell that a member came
from an archive at all.

**Untrusted archives were parsed by a subprocess.** `unzip` decided for itself what a
member path meant, whether to honour a symlink entry, and how many bytes to write. By
the time it returned, the effect was already on disk. A `..` check on the listing it
printed is not a security boundary.

**Encoding eligibility was decided from a prefix, or from a filename.** Discovery
validated the first 8 KiB and declared any known-text extension eligible without
reading it at all. A `.md` file written in Windows-1252 was therefore eligible for
inline injection, which decodes the whole file and writes it back — losing the tail.

Underneath all of these is one confusion: **observation and materialization were the
same code path.** Materializing is a legitimate thing an operator may ask for. Doing
it as a side effect of looking is not.

## Decision

Canonical local-source observation is a separate, read-only acquisition layer
(`src/local_source.ts`). It accepts a file, an ordinary directory, an external-drive
tree, a synced folder, or a ZIP archive. None of them has to be a Git repository.

1. **The source is never modified.** No write, rename, removal, or mode change occurs
   under the observed root, on the success path or on any failure path. Archives are
   staged into a tool-owned scratch directory outside the source tree, and members
   become virtual artifacts. Dry run and canonical observation are the same thing:
   there is nothing to suppress.

2. **A directory is never removed because of its name.** Recursive deletion is
   permitted only inside a scratch root this session created, and only after
   re-reading an ownership token it wrote there. `*.l9extracted` is treated as
   generated output only when an ownership marker *and* an adjacent archive both
   agree; otherwise it is ordinary user content.

3. **Archive members are virtual, not physical.** A member is identified by
   `<archive-path>!/<member-path>` — repository-relative, POSIX, and independent of
   where it was staged. Nested archives compose: `outer.zip!/inner.zip!/src/b.py`.
   Each member is an artifact with the digest of its exact bytes, linked to its
   archive by a `DERIVED_FROM` relationship whose properties carry the archive
   digest, the member path, the nesting depth, and a member identity derived from
   exactly those three facts. A scratch path never reaches a packet.

4. **The archive reader is ours.** `src/zip_reader.ts` reads the central directory
   and streams members under an explicit ceiling, using Node's own zlib. No
   subprocess participates in the canonical security boundary, and no dependency was
   added. `src/archive_preflight.ts` judges every member — path shape, entry type,
   encryption, compression method, duplicate and case- and Unicode-folded collisions
   — before a byte is written.

5. **A violation holds the whole archive.** Expanding the safe half of a hostile
   archive would present a partial view that a consumer cannot distinguish from a
   complete one. A held archive is still observed and hashed, its reason is
   explicit, and none of its members are claimed.

6. **Budgets are enforced twice.** `LocalArchivePolicy` bounds archive size, member
   count, per-member and per-archive and per-session expansion, compression ratio,
   nesting depth, path length and processing time. The declared sizes in the central
   directory are checked first; the bytes actually produced are checked again during
   extraction, because a malicious archive can lie about itself.

7. **Identity is derived, never supplied.** A file is `file:sha256:<digest>`, an
   archive is `archive:sha256:<digest>`, a directory is `fs:sha256:<digest>` of a
   canonical manifest of repository-relative paths, entry kinds, content hashes and
   literal symlink targets. Absolute paths, inode and device numbers, timestamps,
   scratch locations, usernames and hostnames are excluded.

8. **A torn snapshot is refused, not published.** Entries are enumerated, hashed,
   then re-enumerated. If anything moved, the observation is unstable and no
   canonical packet is produced. A missing required content hash blocks it for the
   same reason.

9. **Symlinks are observed, never followed.** The link and its literal target text
   are recorded; the target's bytes are not read. Devices, sockets and FIFOs are
   recorded rather than silently disappearing.

10. **Encoding is validated over every byte before any decode or mutation.**
    `src/encoding.ts` streams a whole file through one fatal decoder in bounded
    memory. An extension still selects a metadata carrier, but it no longer grants
    eligibility: an undecodable file is hashed, diagnosed, and never rewritten or
    interpreted.

11. **Secret-candidate paths are refused as member paths too.** The existing refusal
    applies to `Bundle.zip!/.env` exactly as it does to `.env`. Such a member keeps
    its path, size and digest, and contributes no excerpt and no assertion.

12. **The acquisition manifest lives with the output.** It records archive-relative
    paths, digests, counts, depth, and the policy version. It is never written beside
    the source, and writing it into the observed tree is refused. Its observation
    timestamp is operational and participates in no identity.

The legacy `PipelineConfig.localFiles` materialization path is retained for the
workflow that already depends on it, and is hardened to the same two invariants that
have no legitimate exception: it refuses to remove an extraction target that carries
no ownership marker, and its dry run performs zero source mutation.

## Consequences

- Observing an arbitrary drive, folder, ZIP, or single file is now safe by
  construction, and the read-only claim is asserted in tests by comparing a
  byte-level snapshot of the source before and after.
- Local-source packets declare their own observation profile, so repository packets
  built from a Git checkout keep the identity and golden bundles they already had.
- Two behaviors changed for existing callers, both deliberately:
  `expandArchivesUnderRoot` no longer extracts during a dry run, and it refuses
  rather than deletes when an extraction target is not provably its own output. Both
  are reported through `ArchiveRecord.heldReason`.
- Discovery now reads a known-text file before declaring it eligible. A readable
  UTF-8 file is unaffected; an unreadable or non-UTF-8 one is excluded with an
  explicit disposition instead of being injected into and corrupted.
- v1 expands ZIP only. `tar`, `gz`, `7z`, `rar` and friends are classified as
  archives, hashed, and reported as not expanded. No external tool is consulted to
  guess at them.
- Publication policy, merge policy and the topology consumer contract are unchanged.
