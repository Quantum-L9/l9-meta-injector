# ADR-073: Duplicate-id refusal precedes tree mutation; collisions among extracted archive members are a documented residual

## Status

Accepted

Amends [ADR-054](054-pipeline-identity-and-carrier-lifecycle.md) Decision item 2
(scope of "before any … write"). Consumes, and does not reopen,
[ADR-016](016-local-files-archive-expansion.md) and
[ADR-045](045-archive-execution-and-transactional-materialization.md).

## Date

2026-10-28

## Context

ADR-054 item 2 makes `runPipelineAsync` refuse a run in which two paths normalize
to one metadata id (`DUPLICATE_METADATA_ID`), "before any diff, injection, or
coverage-report write … No source bytes change." The duplicate check ran only after
the metadata-subject loop, and two stages that write into the scanned tree ran
before it (RC-020, finding F-034):

1. `src/pipeline.ts` expanded archives in local-files real runs
   (`expandArchivesUnderRoot`) right after the discovery governability pre-check,
   materialising `<archive>.l9extracted/` directories, their ownership marker and
   `<archive>.l9meta.yaml` sidecars.
2. `normalizeFilenames` wrote `*.normalize.log.yaml` sidecars beside every
   renamable discovered file, in dry-run as well as in a real run.

A tree holding `a-b.md`, `a_b.md` and `bundle.zip` was refused, but the refused run
left `a-b.md.normalize.log.yaml`, `bundle.l9extracted/` and `bundle.zip.l9meta.yaml`
behind. Pre-existing source bytes were unchanged, so ADR-054 was satisfied only
narrowly; the governability pre-check in the same function already states the
stronger rule that a refused run must refuse before it materializes anything.

Normalization renames nothing and changes no path or id, so its position before the
check was never needed. Archive expansion is different: the id of an extracted member
depends on its path and on its body (the primitive segment of the id comes from
classification), so the ids of members cannot be known before the members are read,
and in this pipeline members are read only after they are materialised.

## Options Considered

### Option A: Pre-expansion check plus a documented residual

- Pros: every collision among files that already exist refuses with zero tree
  mutation; no change to archive materialisation mechanics; small change in one
  owner (`src/pipeline.ts`).
- Cons: a collision introduced only by extracted members still refuses after the
  tool-owned extraction artifacts were written; a local-files real run computes
  subjects twice.

### Option B: Roll back this run's extraction directories and sidecars on refusal

- Pros: closer to zero mutation for member-induced collisions.
- Cons: a refreshed extraction directory cannot be restored, because its previous
  contents are removed after the swap (`src/archives.ts`); adds rollback logic to a
  destructive path.

### Option C: Stage extraction outside the tree, compute ids, then swap in

- Pros: fully faithful zero-mutation refusal.
- Cons: the largest change to ADR-045 materialisation mechanics.

## Decision

The owner adopted **Option A**; Option C is revisited only if member-induced
collisions are observed in practice.

1. `normalizeFilenames` runs after `assertUniqueMetadataIds`. A refused run, dry or
   real, writes no `*.normalize.log.yaml`. A successful run writes the same sidecars
   as before, later in the run.
2. A local-files real run discovers the tree as it stands, applies the existing
   governability pre-check, computes the metadata subjects of that tree and applies
   the duplicate-id check, all before `expandArchivesUnderRoot`. Any collision among
   files that already exist refuses with the tree entry- and byte-identical. The
   pre-expansion pass uses the same subject computation as the main pass (a local
   function in `src/pipeline.ts`) except that it skips LLM assist, which only rewrites
   prose-origin fields and never `id`, and it does not repeat schema-gap warnings.
   Dry-run never expands archives and is unchanged.
3. The post-expansion check stays. A collision that only extracted members introduce
   (for example `a-b.zip` and `a_b.zip` both holding `member.md`) refuses with the
   same `DUPLICATE_METADATA_ID` message after extraction. This is the accepted
   residual: the tool-owned `*.l9extracted/` directories (with their ownership marker)
   and `*.l9meta.yaml` sidecars remain, no source byte, normalize sidecar, diff,
   injection or report is written, and the next run refreshes the extraction
   directories idempotently under ADR-045.
4. ADR-054 item 2's message format and its "no source bytes change" guarantee are
   unchanged; its "before any … write" now also covers normalize sidecars and, except
   for the residual in item 3, archive materialisation.

## Consequences

- Refused runs leave fewer artifacts; successful runs produce identical outputs.
- Local-files real runs read and classify the pre-expansion tree twice; the cost is
  bounded to those runs (`localFiles && !dryRun`).
- Repositories whose archives extract to colliding member paths are still refused, and
  the leftover extraction artifacts are expected until the archives are renamed.
- Tests: `tests/duplicate_id_refusal_order.test.ts`
  (`REG-WU-011-RC-020-a` … `-e`).
