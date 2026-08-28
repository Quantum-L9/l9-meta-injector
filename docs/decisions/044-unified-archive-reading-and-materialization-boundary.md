# ADR-044: One ZIP authority, two output modes, and a cache key that names the policy it answered

## Status

Accepted. Completes
[ADR-036](036-read-only-local-source-acquisition.md), which established
read-only local-source acquisition and the staging-based security boundary but
left `src/archives.ts` holding a second, independent archive engine. Extends
[ADR-038](038-multi-root-corpus-incremental-cache-and-readiness-evidence.md),
whose content-addressed cache is the layer whose archive key changes here. None
is superseded.

## Date

2026-08-28

## Context

A forensic audit of the archive and local-source surfaces returned seven
findings. Six were distinct defects; one changed shape under examination. They
did not converge on a missing feature. They converged on the same structural
fact: the repository had two places that decided what a ZIP is, and several
places that decided whether something had changed.

ADR-036 built the canonical reader, preflight and policy, and routed read-only
observation through them. The opt-in `localFiles` materialization path — which
predates it and has a genuinely different job, writing a sibling
`.l9extracted` directory the operator asked for — kept its own `unzip`
subprocess parser and its own extractor. Two engines meant two answers to
"which members does this archive contain, and may they be written". Only one of
them had been hardened.

The cache made a narrower version of the same mistake. An archive's preflight
verdict was keyed on the archive bytes, the reader version, and the archive
policy's *version string*. A version string cannot express a value change. Two
runs both declaring version `1` while permitting compression ratios of 200 and
10 shared a cache entry, so the stricter run was answered out of the looser
run's verdict and admitted an archive the operator had just forbidden. The
cache was not stale; it was answering a different question than the one asked.

Three further findings shared a root. "Has this file changed" was asked in
three places against millisecond mtime alone, while a fourth place — the
incremental-reuse check — already compared nanosecond mtime when both sides had
one. So the phases could disagree about one file, and a filesystem whose tick
is coarser than a write could hide a rewrite inside an equal `mtimeMs`.
Separately, the archive's digest was computed by one read and its bytes staged
by another, with no proof the two reads saw the same file; and a caller-supplied
`scratchParent` could resolve inside the tree the observation promised not to
write to, directly or through a symlink.

The last finding changed shape rather than disposition. Deflate was suspected
of unbounded extraction. It is not: it is bounded by archive, member and session
ceilings. But it buffers a whole member while the documentation implied
streaming throughout. The defect is contract honesty, not memory safety.

## Decision

**One ZIP authority, two output modes.** `src/zip_reader.ts`,
`src/archive_preflight.ts` and `src/local_archive_policy.ts` are the only code
that decides what a ZIP contains and whether its members may be written.
`src/archives.ts` keeps its distinct responsibility — sibling materialization
with ownership markers, which is a mutation the operator opted into — and loses
its independent parser and extractor. The behavioral split between read-only
observation and opt-in materialization is preserved deliberately; it is a real
difference in what the caller asked for. What is removed is the second opinion
about archive safety, not the second output mode.

**Cache identity names the resolved policy, never its version.**
`archiveManifestKey` derives identity from the archive bytes, the reader
version, and a deterministic fingerprint over every field of the fully resolved
policy. The version does not contribute and is not a parameter, so it cannot be
passed, defaulted, or fallen back to. The fingerprint is statically required:
constructing a key without one is a compile-time error, not a runtime miss.

**One comparator for file state.** `observedFileStateMatches` compares size and
then the finest mtime both observations actually recorded. Milliseconds still
decide where either side has nothing finer, so platforms without nanosecond
mtime are unaffected. Timestamps remain a revalidation signal and never content
truth.

**The staged archive must be the hashed archive.** An `ArchiveTask` carries the
digest the physical snapshot recorded for it. A mismatch at staging holds the
archive, claims no member, and makes the observation unstable. A member staged
out of a parent archive carries no expectation: its bytes were produced by this
run rather than observed, so there is nothing to hold it to.

**Scratch cannot resolve inside the source.** Both paths are resolved through
symlinks and compared before any directory is created. A caller-selected scratch
outside the source remains supported.

**The memory contract is stated as it is.** Stored members are incremental;
deflated members are decompressed synchronously into a bounded buffer under hard
ceilings. Documented rather than redesigned: no measured need justifies an async
public API migration.

## Consequences

An archive gets one verdict from one engine, and hardening it hardens both
output modes at once. A policy change is a different question and gets a
different cache entry, which costs recomputation exactly when the rules moved.
A file that changed inside one millisecond is seen to have changed by every
phase that asks. An archive swapped between hashing and staging yields no member
claim rather than a member reported under a digest that no longer describes it.
A scratch root inside the source is refused before it can exist.

The fingerprint is strictly finer than the version it replaces, so warm caches
written under the old key are not readable under the new one and are recomputed
once. That is the intended direction: the old entries cannot prove which policy
they answered.

Deflate's whole-member buffering remains. It is bounded and now documented, and
the ceilings are the safety property. A future streaming decompressor would be
a performance change, not a security one, and would not alter this decision.

## Alternatives considered

**Make `localFiles` read-only and delete the sibling output.** Rejected: the
sibling directory is the feature, deliberately opted into, with ownership
markers that make its cleanup safe. The duplication to remove was the parser,
not the output mode.

**Keep the policy version in the cache key alongside the fingerprint.**
Rejected: a key the version can influence is a key that can carry the original
confusion. Inert is not the same as absent.

**Let a missing fingerprint fall back to a version-derived key.** Rejected, and
this is the sharper form of the previous point: a deterministic unqualified key
is the same defect wearing a new name, because two policies with no fingerprint
would share one entry. During the rewiring a missing fingerprint produced a
permanently-unsatisfiable key; that branch was removed once every caller
supplied one, so absence is now a compile error rather than a cache that
silently never hits.

**Rewrite deflate as a streaming decompressor.** Rejected: it would change the
public API for a bound that is already enforced, on no measured evidence. The
finding was that the documentation lied, and the documentation was corrected.
