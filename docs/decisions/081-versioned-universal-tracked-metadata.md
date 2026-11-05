# ADR-081: Versioned universal tracked-entry metadata and protected coverage

## Status

Accepted technical contract by explicit operator approval on 2026-11-03. Implementation and qualification results must be reported separately; acceptance is not release or fleet-adoption authorization.

## Scope and relationship to earlier decisions

The TypeScript producer owns this technical contract. `Quantum-L9/.github` remains the global semantic authority; this ADR neither admits new global law nor copies its ledgers. ADR-023/024/025/026 retain their existing v1 meaning. ADR-054/071 legacy namespace IDs, v1 index bytes/readers and existing annotation APIs remain compatible. The comment-carrier work in separate PR #123 (ADR-080) is not a dependency of this standalone change and is not silently repealed.

This decision extends the existing discovery, namespace, carrier-policy, metadata-index and carrier-operation owners with an explicitly selected **tracked v2** contract. It does not introduce a second writer, per-repository classifiers, metadata service, adjacent sidecar strategy or database.

## Context

Filesystem mutation-candidate discovery is not a complete Git population. Hidden directories, links, binaries, generated outputs and protected producer state can be omitted without violating that older domain. Lossy v1 ID normalization can also refuse legitimate distinct paths. These accepted constraints cannot substantiate universal tracked-entry coverage.

The supplied 2026-11-03 strategy and breaktest distinguish accounting from mutation and identify self/index-manifest hash cycles. Every source entry needs exactly one outcome, but not every entry can safely receive an inline header, a content digest or a normal in-index record.

## Decision

### Exact population and observation

The source population is every recursive **leaf entry** in one explicit immutable Git commit tree: regular blobs, symlink blobs (`120000`) and gitlinks (`160000`). Tree-directory containers, `.git` internals, untracked/ignored local contents and remote submodule contents are outside this population. A force-tracked ignored file remains inside it.

Resolve the caller's revision once to an exact commit and root tree. Read binary-safe NUL-delimited tree metadata with an absolute Git executable, argv-only commands, bounded output/time and no optional locks, lazy fetch, shell, checkout or subject payload reads. A failed/missing/malformed/truncated census is a failure, never an empty complete repository. Git SHA-1/SHA-256 object identity is not a measured content SHA-256.

### Identity and evidence

Canonical identity is the portable declared repository identity plus **exact Git path bytes**. Preserve punctuation, case, Unicode normalization and invalid UTF-8 without replacement or sibling-dependent suffixes. A reversible versioned tuple encoding provides path-exact identity; legacy normalized IDs are aliases only, with ambiguity explicit rather than destructive source renames.

Retain Git mode, object type and object OID independently of content-inspection state. Default census does not inspect subject blobs, extract archives, read links or follow submodules. Content digest and size remain Unknown/not-inspected when not measured. Filename-based binary/generated hints are not content verification.

### One resolver and complete closure

`src/mutation_policy.ts` alone decides each tracked disposition. Symlinks, gitlinks, known archives/media and generated/vendor/lock state are read-only inventory carriers. Arbitrary hidden controls and regular source/configuration/prose/unknown files are read-only central carriers where representable. Secrets, unsupported representations and protected index/self-manifest paths have an explicit protected outcome.

`src/metadata_index.ts` compiles both the one canonical v2 index and its complementary external coverage receipt from that same decision set. Closure proves exact path-identity set equality and matching mode/type/OID, not just equal totals. Duplicate, missing, extra or swapped-evidence outcomes refuse the result.

Every tracked entry is either a v2 metadata record or a justified protected/unsupported receipt. `indexed + protected + unsupported = tracked`, each exactly once. The receipt is evidence, not a second authoritative index.

### Versioned storage and compatibility

V2 is explicitly selected. Its canonical representation must retain version identity even when there are zero records, preserve homogeneous version dispatch and reject unknown/mixed versions. V1 parsing, serialization, body-hash meaning, ID behavior and valid operations remain unchanged. A legacy writer must refuse implicit replacement of an active v2 store. Migration from v1 requires an explicit operation; old aliases/evidence must be clearly labeled, not silently promoted to current proofs.

Consented migration retains actual consumed v1 ID values in optional historical `legacy_identity_claims` inside the same header. Preserve the old source-index byte hash and migration-time snapshot, not a target-index self-hash. V2 replay carries that history unchanged; retired/protected historical paths are not current entries. Legacy content-hash claims remain explicitly unvalidated for current content. The separate external migration receipt may bind final target bytes. See [operation and rollback guide](../universal-tracked-metadata.md).

The only active repository index remains `.l9/metadata-index.jsonl`. No concurrent v1/v2 writable stores or adjacent source sidecars are created. The external receipt binds the exact **input commit tree**, never claims generated output is already committed, and may record the prior index object's Git identity without a content-hash cycle. Index bytes must not embed the identity of the final tree that contains them. Root `GIT_TREE_MANIFEST.json` is conservatively protected and accounted externally.

### Conservative operation boundary

The initial tracked v2 seam is **index-first and index-only**. It builds no source/header mutation intents, including for Markdown. This conservatively satisfies the rule that only proven, expressly authorized plain Markdown could ever be an inline target; it does not claim a new universal inline renderer. Legacy v1 annotation remains unchanged and cannot serve as a downgrade or alternate writer for a v2 index.

Tracked coverage is read-only and content-free by default. Tracked check compares the active index without repairing it. Tracked apply requires the repository's canonical authority, explicit v1 migration when needed, exact current source revision, no changed tracked source files, and the established whole-run compare-and-swap transaction. Recheck source currentness after committing the index and roll back on postcondition failure. Read-only entries can never become source write intents. Exported coverage goes outside the source repository with symlink-safe placement; no implicit report file is added to the tracked population.

### Adoption, freshness and release

Qualification uses disposable read-only snapshots of Topology, EIE, CEG, Cursor-Governance, Gate and Odoo where approved access is available. Keep private per-path outputs private; publish only nonsensitive aggregate results. Measure timings and memory rather than invent performance claims.

This change does not mutate consumer PRs, rebind Topology #35, override its manual/no-CI refresh choice, deploy recurring freshness enforcement, merge anything or publish a release. Receipt freshness is explicitly snapshot-bound. Protocol versioning does not authorize a package-semver release. The current package version remains unchanged until the separately governed release procedure is approved.

## Validation and falsification

Tests must cover exact historical/staged/dirty/noise populations; hidden/generated/ignored-but-tracked entries; punctuation, case and Unicode/raw-byte identity; symlinks and gitlinks without traversal; binary/archive accounting without extraction; protected self/manifest receipts; equal-count missing/extra/duplicate/evidence-swap refusal; empty-version and v1/v2 migration/downgrade behavior; no source writes; stale-source/CAS/symlink guards; repeat determinism and zero-write second apply; bounded/failing Git commands; installed public API and CLI behavior; and read-only cross-repository qualification.

A case is PASS only after it is executed against the named candidate. Content-free census does not prove blob encoding, arbitrary LFS signatures, semantic classification, absence of competing writers, source-path materializability on every filesystem or continuous fleet freshness. Those Unknowns must remain explicit.
