# ADR-077: Stale publisher-lock takeover runs under an exclusive takeover guard

## Status

Accepted

Amends [ADR-066](066-generation-retention-order-and-exclusive-publisher-lock.md)
Decision item 3 (“A lock whose holder is a pid that is not alive on the same host is
taken over once”). Records the mechanism shipped in commit `0abb12a` for audit finding
G01.

## Date

2026-10-29

## Context

ADR-066 item 3 makes `publishCorpusGeneration` hold an exclusive
`.corpus-publish.lock` in the output root, so that one publisher at a time switches and
prunes generations. A lock left by a dead process on the same host is taken over.

At `ebc0dd3` that takeover in `acquirePublishLock` (`src/corpus_publish.ts`) was three
separate steps: read the holder, `rmSync` the lock, create a new lock with an exclusive
open. Two publishers that both read the same dead holder could interleave so that the
second removed the lock the first had just created and created its own, and both went on
to publish (finding G01). The regression test reproduces it: publisher B took over A's
live lock, published, pruned A's generation, and A's switch then threw “generation … is
missing” (`REG-AUDIT-G01-a`, failing on `ebc0dd3`).

## Options Considered

### Status quo: read, remove, create

- Pros: no extra file.
- Cons: the race above; ADR-066 item 3's single-publisher guarantee does not hold for a
  takeover.

### Takeover under an exclusive guard with compare-before-remove (adopted)

- Pros: the takeover becomes exclusive; ordinary acquisition (lock free) is unchanged
  and never touches the guard; a crash inside the takeover is recoverable on the same
  host without operator action.
- Cons: a second transient file; a narrow residual window remains (Consequences).

## Decision

1. **Ordinary acquisition is unchanged.** `acquirePublishLock` creates
   `.corpus-publish.lock` with an exclusive open (`wx`), writes
   `{pid, host, acquired_at}` plus a newline, and `fsync`s it. A lock whose holder is
   live, on another host, or unreadable is refused immediately with the existing
   message naming the lock file.
2. **A stale lock is taken over only under the guard.** A holder is stale when the lock
   parses with an integer `pid > 0` and a string `host`, `host` equals `os.hostname()`,
   and the pid is not alive (`holderIsStale`). The publisher then creates
   `<lock>.takeover` (`TAKEOVER_GUARD_SUFFIX`) with an exclusive open and the same
   `{pid, host, acquired_at}` record. Under the guard it re-reads the lock, removes it
   only if its text is byte-equal to the text it judged stale, and creates its own lock
   with an exclusive open. If that create finds a lock, another publisher took it over
   first, and this one is refused naming the current holder. Of two publishers that
   judged the same lock stale, exactly one ends up holding it.
3. **Release compares before removing.** The guard is released in a `finally`, and the
   lock as before, each only if the file still holds this publisher's bytes
   (`releaseOwned`).
4. **A contended guard is refused.** A guard held by a live process, by another host,
   or that cannot be read is refused with the publisher refusal, extended by
   “, taking over a stale lock under <guard>”.
5. **A dead guard is reaped once per acquisition.** A guard whose holder is a dead
   process on this host (a publisher killed inside its takeover) is renamed aside to
   `<guard>.<pid>.<hrtime>.reap`. If the moved bytes equal the dead holder's bytes they
   are deleted and the guard create is retried once. Otherwise a live guard was moved by
   mistake: it is linked back with `linkSync` (which never overwrites), the moved file
   is deleted, and this publisher is refused. If the lock itself is absent, the next
   publisher takes it normally and leaves a dead guard inert until a later takeover
   reaps it.

## Consequences

- ADR-066 item 3's single-publisher guarantee now also holds for a stale-lock takeover.
  Error messages keep the ADR-066 form; only guard contention adds the guard path.
- A transient `.corpus-publish.lock.takeover` exists in the output root only while a
  takeover runs, or, after a crash inside one, until the next takeover reaps it.
- **Residual window (accepted limitation).** If two publishers reap the same dead guard
  and a third creates a guard between one reaper's rename and its `linkSync`, two guard
  holders can coexist. This needs a crash inside the takeover window plus three
  concurrent publishers on one output root. On a filesystem without hard links the
  put-back fails and the moved guard is dropped, with the same narrow consequence.
- No public API change: `src/corpus_publish.ts` is not in the public API contract.
- Tests: `tests/corpus_publish.test.ts` (`REG-AUDIT-G01-a` … `-d`).
