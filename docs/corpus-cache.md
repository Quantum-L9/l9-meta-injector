# The corpus cache

The cache exists because a corpus spread over several drives is mostly unchanged
most of the time, and decoding, interpreting and tokenizing bytes that did not
move is the largest avoidable cost in a repeat scan.

It is an accelerator. It is never an authority. Every claim below follows from
that one sentence, and the design is mostly a matter of refusing to let the cache
become anything else.

## Where it lives

Default `~/.l9/corpus-cache`, overridable with `--cache-root` (or the older
`--cache-dir`, and `$L9_CORPUS_CACHE`). `--no-cache` runs cold: nothing is read
and nothing is written.

A cache root inside an observed root is refused. The path is resolved through
`realpath` first, so a symlinked cache directory pointing into a tree being
observed is refused too — a lexical check would approve it and then write through
it, which would mutate the source this package promises not to touch and would
make the next run read this run's output as user content.

## What is keyed on what

| Layer | Key |
|---|---|
| `archive_manifest` | archive content hash, reader version, archive policy version |
| `raw_identity` | exact content hash |
| `normalized_document` | exact content hash, decoder id, decoder version |
| `interpretation` | normalized document identity, source path, interpretation profile |
| `lexical_features` | normalized document identity, lexical profile |
| `embedding` | normalized document identity, chunk profile, provider, model, revision |
| `candidate_analysis` | the whole input feature set, candidate profile |

Every key names the rules as well as the bytes. A stricter archive policy is a
different question about the same archive and must not be answered out of the
looser policy's entry; a decoder revision produces a different document from the
same bytes and must not be served the old one.

## What a cached interpretation does not carry

An assertion names the repository it was read in, both in its subject and in its
own id. The interpretation key is the normalized document plus the source path —
and in an archive corpus two roots routinely hold the same bytes at the same
relative path, because one is a backup of the other. So an entry written while
scanning one root *will* be read back while scanning another.

Stored interpretations therefore carry no subject at all. `toPortableAssertions`
strips the subject and the assertion id before writing;
`bindPortableAssertions` derives both afresh for whichever root is reading. The
cache key records the format change, so an entry written by a release that stored
subject-bound ids can never be served.

This was a real defect, not a hypothetical one: before the split, the second root
filed its own documents under the first root's artifacts.

## Integrity

Every entry declares its schema, layer, key, producer version and a hash of its
own payload. On read the payload hash is recomputed and the key components are
validated. An entry that fails, or is not valid JSON at all, is discarded,
recomputed, and reported as a diagnostic — never used and never silently ignored.
An entry written by a different producer version is a miss.

Entries are written to a sibling file and renamed. A rename is atomic on a single
filesystem, so an interrupted write cannot leave a half-written entry that a later
run reads as complete. Two processes computing the same immutable key each write a
complete entry and the last rename wins with identical bytes; the key is
content-addressed, so there is no other outcome to lose.

## Privacy

The cache holds decoded text from an operator's private documents. Directories
are created `0700` and entries `0600` rather than inheriting whatever umask the
run happened to have, and a cache root created by an earlier release is tightened
on open rather than left open. A filesystem with no POSIX permission model is
handled by proceeding: the cache is local-only and is never authoritative, and
refusing to cache there would be a worse answer than caching without the mode.

Documents whose path looks like a credential are never decoded, so their text
never reaches the cache. No document content is ever logged.

## What the cache does not do

It does not delete anything. Pruning a cache is operational lifecycle work, and
introducing an automatic deletion path into a tool whose entire purpose is to read
archives without changing them is a hazard out of proportion to the disk it would
save. Removing a cache root is `rm -rf` on a directory the operator chose.

It does not decide identity. Content hashes are computed from bytes on every full
run; what the cache holds is what was *derived* from those bytes. `--incremental`
is the one place a previous run's hash is carried forward, it is disclosed in the
snapshot, and it can never produce a `fully_verified` label — see
[`corpus-scale-operation.md`](corpus-scale-operation.md).

## What is still recomputed

An archive's bytes are staged on every run even when its preflight verdict is
cached, because the members are needed by whatever reads them next and a verdict
is not members. Skipping the decompression entirely needs expansion on demand —
staging an archive only once something actually asks for a member's bytes — which
this release does not implement.
