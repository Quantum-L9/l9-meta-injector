# ADR-066: Generation retention order and exclusive publisher lock

## Status

Accepted

Amended by [ADR-077](077-stale-publisher-lock-takeover-guard.md): Decision item 3 — a stale lock is taken over only under an exclusive `.corpus-publish.lock.takeover` guard, removing the lock only if it still holds the bytes judged stale, so exactly one of two racing publishers ends up holding it.

## Date

2026-10-28

## Context

[ADR-042](042-binary-document-decoding-generational-publication-and-bounded-candidate-work.md)
publishes corpus outputs into `generations/<content-hash>/` and makes them visible with
one durable rename of `CURRENT.json`; pruning happens after the switch and never touches
what the pointer names. Two defects in `publishCorpusGeneration`
(`src/corpus_publish.ts`) broke that contract:

- **RC-069 (F-062).** Retention selected the generations to prune by code-point order of
  their content-addressed directory names, because nothing recorded publication order.
  `keep: N` therefore kept the current generation plus the N-1 lexicographically largest
  other hashes. With `keep: 2`, six publishes kept runs 6 and 4 and pruned run 5 — the
  immediately previous generation, which is the rollback target and the one a concurrent
  reader may still hold. The `keep` documentation ("newest first") was not true.
- **RC-072 (F-126).** The function assumed a single writer per output root. Prune excluded
  only its own generation and never re-read the pointer, the switch did not re-verify the
  generation, and nothing serialised publishers. A publisher B running between publisher
  A's write and A's switch pruned A's directory, after which A switched `CURRENT.json` to a
  directory that no longer existed.

## Options Considered

### Retention order (DEC-RC-069)

#### Option A: newest-first history list inside `CURRENT.json`, written in the same atomic switch

- Pros: no new file, no clock dependence, deterministic; the record of publication order
  moves in the same rename as the switch it describes.
- Cons: an additive pointer field.

#### Option B: directory mtime refreshed on every switch

- Pros: no format change.
- Cons: clock and granularity dependent (FAT 2 s), and touches a generation directory
  documented as never touched again.

#### Option C: a separate publication ledger file in the output root

- Pros: the pointer is unchanged.
- Cons: a second file that must stay consistent with `CURRENT.json` across crashes.

### Concurrency (DEC-RC-072)

#### Option A: exclusive output-root lock in `publishCorpusGeneration` with stale-pid takeover

- Pros: simple and provable; one transient file.
- Cons: needs stale-lock handling.

#### Option B: lock-free — prune re-reads the pointer and spares unrecorded directories, the switch re-verifies

- Pros: no lock file.
- Cons: cannot close every interleaving (a generation can be deleted between verify and
  rename), and crash orphans then accumulate.

#### Option C: lock in the CLI caller only

- Pros: library unchanged.
- Cons: leaves library callers of `publishCorpusGeneration` unprotected.

## Decision

The owner adopted **Option A** for retention order and **Option A** for concurrency, with
Option B's re-read and verification kept as defence in depth.

1. `CURRENT.json` (`l9.corpus-current/v1`) gains the additive field
   `previous_generation_ids`: the generation ids that were current before this one,
   newest first. A publish builds it from the previous pointer (its `generation_id`,
   then its own list; a pointer without the field contributes only its
   `generation_id`), drops the id being published and duplicates, and bounds it to
   `max(keep, 16)` entries. It is written in the same durable rename as the switch.
   `readCorpusCurrent` still accepts pointers without the field.
2. `keep: N` retains the N most recently switched-to generations, including the one just
   published. Pruning removes, until N directories remain: first directories with no
   publication record (crash orphans, generations from before the upgrade, a recorded id
   that fell off the bounded list), in code-point name order; then recorded generations
   beyond the newest N, oldest first. The generation just published is never pruned.
   `DEFAULT_KEEP` and `--keep-generations` are unchanged.
3. `publishCorpusGeneration` takes an exclusive lock file `.corpus-publish.lock` in the
   output root with a create-exclusive open before writing anything, recording `pid`,
   `host` and `acquired_at`, and removes it in a `finally` after pruning (only if the file
   is still the one it wrote). A lock whose holder is a pid that is not alive on the same
   host is taken over once. A lock held by a live process, by another host, or whose
   content cannot be read is refused with an error naming the lock file; nothing is
   written.
4. Under the lock, immediately before the switch, every file of the generation is
   verified to exist; a missing file throws and `CURRENT.json` is not switched.
   Immediately before pruning, `CURRENT.json` is re-read and the generation it names is
   excluded from pruning.

This amends ADR-042's "A whole output set appears at once, or not at all" section: the
retention order and the single-publisher guarantee are now stated rather than assumed.

## Consequences

- `CURRENT.json` carries one more field. Readers that resolve `generation_ref` are
  unaffected; consumers that compare the pointer's exact key set must allow it.
- The first publish after the upgrade knows only the immediately previous generation;
  older directories are treated as unrecorded and pruned first.
- `PublishResult.pruned_generation_ids` names different directories than before (by
  recency, unrecorded first) for the same `keep`.
- A transient `.corpus-publish.lock` exists in the output root while a publish runs.
  Concurrent publishers into one output root no longer race: the second is refused
  with an actionable message. A crash leaves a lock with a dead pid, which the next run
  on the same host takes over; a lock from another host must be removed by the operator.
- No public API change: `src/corpus_publish.ts` is not in the public API contract.
