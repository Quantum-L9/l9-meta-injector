# ADR-044: One ZIP authority, two output modes, and a cache key that names the policy it answered

## Status

Accepted, with the **policy-version identity point amended by ADR-045**.

Completes [ADR-036](036-read-only-local-source-acquisition.md), which established
read-only local-source acquisition and the staging-based security boundary but
left `src/archives.ts` holding a second, independent archive engine. Extends
[ADR-038](038-multi-root-corpus-incremental-cache-and-readiness-evidence.md).
ADR-045 later converges the two execution modes on one run-scoped archive
execution context and treats the policy contract version as a conservative
semantic epoch inside the resolved-policy fingerprint.

## Date

2026-08-28

## Context

A forensic audit of the archive and local-source surfaces returned seven
findings. Six were distinct defects; one changed shape under examination. They
converged on the same structural fact: the repository had two places that
decided what a ZIP is, and several places that decided whether something had
changed.

ADR-036 built the canonical reader, preflight and policy, and routed read-only
observation through them. The opt-in `localFiles` materialization path kept its
own `unzip` subprocess parser and extractor. Two engines meant two answers to
"which members does this archive contain, and may they be written". Only one of
them had been hardened.

The cache made a narrower version of the same mistake. An archive's preflight
verdict was keyed on archive bytes, reader version, and only the archive policy's
version string. A version string cannot express value changes. Two runs both
declaring version `1` while permitting compression ratios of 200 and 10 could
therefore share an entry and answer the stricter run from the looser verdict.

Three further findings shared a root. File-change checks used inconsistent
mtime precision; archive digest and staging were separate reads with no proof
they observed the same bytes; and caller-selected scratch could resolve inside
the supposedly read-only source tree. Deflate was also documented as streaming
throughout even though deflated members are synchronously buffered under hard
ceilings.

## Decision

**One ZIP authority, two output modes.** `src/zip_reader.ts`,
`src/archive_preflight.ts` and `src/local_archive_policy.ts` decide what a ZIP
contains and whether its members are admissible. `src/archives.ts` retains only
its distinct materialization responsibility. The output modes differ; archive
safety authority does not.

**Cache identity names the complete resolved policy.** `archiveManifestKey`
derives identity from archive bytes, reader version, and a deterministic
fingerprint over every field of the fully resolved policy. Numeric and resource
fields prevent two different rule sets from sharing a verdict. Under ADR-045,
the explicit policy `version` also contributes as a conservative semantic epoch:
a version bump invalidates warm verdicts even when the visible numeric limits
happen to remain unchanged. This is strictly safer than replaying a verdict
across an intentionally revised contract. A version string is never sufficient
by itself; the full resolved fingerprint remains mandatory.

**One comparator for file state.** `observedFileStateMatches` compares size and
then the finest mtime both observations actually recorded. Timestamps remain a
revalidation signal and never content truth.

**The staged archive must be the hashed archive.** An `ArchiveTask` carries the
digest the physical snapshot recorded for it. A mismatch at staging holds the
archive, claims no member, and makes the observation unstable. ADR-045 extends
that identity discipline to the mutating localFiles path through immutable
staging before admission and materialization.

**Scratch cannot resolve inside the source.** Both paths are resolved through
symlinks and compared before any directory is created.

**The memory contract is stated as it is.** Stored members are incremental;
deflated members are decompressed synchronously into a bounded buffer under hard
ceilings. This is a documented memory contract, not a claim that every
compression method streams.

## Consequences

An archive gets one verdict from one engine, and hardening that engine hardens
both output modes. A policy value change or policy-version epoch is a different
cache question and receives a different key. Warm entries from earlier policy
identity schemes are naturally recomputed once.

A file that changed inside one millisecond is compared at the finest timestamp
available. An archive whose staged bytes contradict its observed identity yields
no member claim. Scratch resolution cannot silently route writes back into the
source.

Deflate's whole-member buffering remains bounded and explicit. A future
streaming decompressor would be a performance change, not a change to the
admission authority.

## Alternatives considered

**Make `localFiles` read-only and delete sibling output.** Rejected: sibling
materialization is an explicit feature. The duplication to remove was the
second archive authority.

**Use policy version alone as cache identity.** Rejected: identical version
labels can carry different resolved limits.

**Exclude the policy version from the resolved fingerprint.** This was the
original ADR-044 choice. ADR-045 amends it after convergence work established
`version` as the explicit policy-contract epoch. Including it only causes a
conservative cache miss; excluding semantic rule values would be unsafe, so all
resolved fields remain fingerprinted.

**Let a missing fingerprint fall back to a version-derived key.** Rejected. A
missing resolved fingerprint is a compile-time/contract error, never a cache
fallback.

**Rewrite deflate as a streaming decompressor.** Rejected absent a measured need;
the existing hard ceilings are the safety property.
