# ADR-027: Whole-run transactional apply

## Status

Accepted.

## Context

Carrier-aware planning and compare-and-swap checks prevented stale individual writes, but apply still mutated authorized inline files one at a time and wrote the central metadata index separately. A later failure could therefore leave a repository in a mixed state.

## Decision

Apply compiles every changed inline carrier and the canonical metadata index into one immutable set of complete replacement bytes. The runtime then:

1. validates every planned original hash and path boundary;
2. writes each replacement to a same-directory temporary file and fsyncs it;
3. persists a repository-relative journal under `.l9/.transactions/`;
4. rechecks all original states immediately before commit;
5. renames originals to backups and staged files to targets;
6. runs hash, metadata-index, and semantic verification while backups remain available;
7. deletes backups and the journal only after validation succeeds;
8. restores the entire set in reverse order on any failure.

An interrupted process leaves the journal and same-directory backups. The next governed apply recovers those journals before creating a new plan.

## Consequences

- No successful apply can expose a partially updated carrier set.
- Concurrent drift blocks the whole operation.
- Validation failure becomes a rollback trigger rather than a post-write warning.
- Adjacent sidecars and inject logs remain forbidden.
- The implementation does not claim a cross-filesystem atomic primitive. It provides an all-or-restored protocol from same-directory atomic renames, durable journaling, compare-and-swap checks, and verified rollback.
