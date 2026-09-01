# ADR-045: Archive execution shares one admission context and materializes transactionally

## Status

Accepted

## Date

2026-09-01

## Context

The main convergence contract `l9-meta-injector-main-convergence-v1` audited the
archive paths against `origin/main` at `4c28c57` and recorded six gaps, all on
the legacy mutating materialization path and its shared reader:

1. **Validation truth.** The validation report's tree digest was bound to
   `git ls-files -s` index blobs plus porcelain status classes, so a second edit
   of an already-dirty file moved neither and was invisible to the stop
   condition.
2. **ZIP framing.** The EOCD search returned the last signature and stopped;
   comment-to-EOF and multi-disk rejects were absent, so an archive with
   trailing bytes or split-disk fields was parsed as if complete.
3. **Shared execution context.** `localFiles` and `local_source` resolved the
   archive policy and session budget independently, and `extractZip`
   preflighted every archive at depth 0 — nested archives were never judged at
   the depth they actually occupy.
4. **Transactional materialization.** `extractZip` recursively deleted the live
   extraction directory and wrote members into it, and wrote the ownership
   marker *before* any member landed. A member that failed mid-write left the
   operator with a partially replaced tree.
5. **Ownership + budget.** Destructive authority accepted any owner string with
   the `l9-meta-injector.` prefix, so a spoofed owner borrowed this package's
   authority; an empty unmarked directory was silently replaceable.
6. **Dry-run equivalence.** The dry-run branch reported "would extract" without
   running preflight or the ownership refusal, so a held archive read as an
   extraction plan.

## Options Considered

### Option A: Shared execution context, same-directory candidate, atomic swap

- Pros: one admission path for both archive consumers; the live target is never
  the half-written one; the swap is a same-device rename pair, atomic from the
  reader's point of view; ownership and budget flow through one object.
- Cons: more moving parts on the destructive path; a backup directory exists
  briefly during a refresh swap.

### Option B: Keep in-place writes, move the marker later

- Pros: minimal diff.
- Cons: a member that fails mid-write still leaves a partially replaced tree —
  the exact failure the audit recorded. Rejected.

### Option C: Stage in `os.tmpdir()`, then copy into place

- Pros: reuses the observation path's scratch discipline.
- Cons: a rename across devices is not possible, a copy is not atomic, and the
  copy window doubles the failure surface. Rejected.

## Decision

We choose **Option A**.

- `src/archive_execution.ts` introduces `ArchiveExecutionContext`: the central
  directory is read once, preflighted once at the archive's real depth, and the
  resolved policy and session budget are carried with the verdict.
  `resolveArchiveExecution` is the single resolution point both `archives.ts`
  and `local_source.ts` share.
- `extractZip` materializes members into a same-directory candidate, writes the
  v2 ownership marker only after every member is verified, then swaps the
  candidate into place: the previous target is renamed aside to a backup and
  restored if the candidate rename fails, and the backup is removed only after
  the swap succeeded.
- The ownership marker is schema `l9-meta-injector.local-files-extraction/v2`
  (`schemas/local-files-extraction-v2.schema.json`): exact owner, archive
  basename, archive sha256, creation time. Destructive replace requires the
  exact schema and owner; empty unmarked targets and legacy v1 markers are
  refused as user data. Non-destructive observation exclusion keeps recognizing
  legacy markers, now by exact owner id rather than prefix.
- The dry-run branch constructs the same context, surfaces the identical
  refusal and hold text as a real run, and only then reports what would be
  materialized — still with zero source-tree mutation.
- `locateEocd` requires the EOCD comment to carry exactly to EOF and rejects
  any non-zero disk field or an on-disk entry count that disagrees with the
  total.
- The validation report digest now hashes the actual bytes of every tracked and
  untracked file, so every edit — including a second edit of an already-dirty
  file — moves the digest.

## Consequences

- A directory extracted by an older release (v1 marker, no schema field) is no
  longer refreshable: the destructive path refuses it and the operator removes
  it manually to re-extract. This is deliberate fail-closed behavior; v4.0.0 is
  the only release that ever wrote the v1 marker.
- Extraction refresh briefly requires twice the target's disk (candidate plus
  backup). The swap is same-directory, so rename stays same-device.
- Two pre-existing load-sensitivity defects were fixed in the same work (rule
  42: in scope the moment they are identified): the suite-wide Vitest timeout
  budget is raised to 30s and workers are capped at half the machine's
  parallelism. No test was weakened and no skip was added.
- The audit's remaining obligations — `FINAL_FINDINGS.md` and the v4.0.1
  release plan — live in this repository's root and `docs/release/`
  respectively.
