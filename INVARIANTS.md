# l9-meta-injector Invariants

These invariants describe the active TypeScript package and its governed distribution. A change that violates one of them is incomplete even when a narrow unit test passes.

## Runtime and authority

### INV-001: One active engine

The TypeScript pipeline under `src/` is the sole active engine. The Python consolidation tree is reference-only and must not become a competing runtime, schema authority, or release path.

**Enforced by:** `docs/architecture-authority.json`, `npm run check:authority`, architecture-authority tests.

### INV-002: Orchestration-first stable root

The package root exposes the supported orchestration boundary. Stable and experimental subpaths remain explicit, and unlisted deep imports remain denied.

**Enforced by:** `package.json#exports`, `docs/public-api-contract.json`, `npm run check:api`, packed-consumer tests.

### INV-003: Metadata injection preserves the artifact body

Injection may add or update governed metadata but must not silently rewrite the underlying body. Re-running the same operation must be idempotent.

**Enforced by:** injection and pipeline tests, selfpack fixtures, verification output.

### INV-014: Operations and repository authority fail closed

The canonical operation modes are `inventory`, `check`, `apply`, and `skills`.
The legacy name `pipeline` is only a deprecated alias for `apply`; unknown mode
values are errors and never fall back. `check` and `apply` require a compatible
`.l9/meta-authority.yaml` declaration and may not infer repository authority.

**Enforced by:** `src/operation_contracts.ts`,
`schemas/meta-authority.schema.json`, operation-contract tests, public API tests,
and packed-consumer tests.

### INV-015: Check never mutates the target repository

`check` computes the canonical expected metadata state without applying it. It
must not normalize filenames, extract archives, create metadata sidecars, write
diffs, logs, reports, indexes, or alter any target byte. A before/after repository
snapshot is mandatory and any detected change fails with
`CHECK_MUTATION_DETECTED`.

**Enforced by:** `src/check.ts`, non-persisting injection plans, recursive
before/after hash fixtures, CLI report containment, and Action check routing.

### INV-016: Invocation inputs are data and paths remain contained

The composite Action and canonical operation CLI must resolve an exhaustive
operation mode before execution. Caller inputs enter through environment or argv
boundaries, never through generated shell source. Child commands use argument
arrays with `shell: false`. Target and output paths must remain within their
intended roots after realpath and symlink evaluation. External Actions are pinned
to full immutable commit SHAs.

**Enforced by:** `scripts/operation-cli.js`,
`scripts/lib/operation-dispatch.js`, Action source tests, mode-parity tests,
path-traversal fixtures, and immutable-reference checks.

### INV-017: Persisted identity is deterministic and discovery is complete

Canonical per-file metadata stores repository-relative POSIX source paths and
defaults its file timestamp to `Unknown` unless a stable timestamp is explicitly
provided. Runtime timestamps remain outside canonical metadata. Every encountered
filesystem path receives one terminal discovery disposition. Unreadable paths,
symlinks, and unsupported filesystem entries block apply and fail check as
unsupported evidence. Declared omit files are strict inputs and never fail open.

**Enforced by:** `src/discovery_contracts.ts`, `src/retrieval.ts`,
`src/omit.ts`, dual-root determinism fixtures, ledger reconciliation tests, and
fail-closed omit tests.

### INV-018: Every discovered path has one explicit metadata carrier

Carrier choice is a deterministic policy decision, not an incidental consequence
of comment syntax. Protected internals and binaries are `hard_skip`; generated,
vendored, and lock-state artifacts are `inventory_only`; source, configuration,
tests, workflows, infrastructure, and structured data are `central_manifest`;
`inline_managed` requires both an approved L9 prose artifact type and an explicit
safe `inline_allow` match. Skills mode does not bypass repository authority
(ADR-033): it fails closed without resolved authority and commits `SKILL.md`
changes through the governed transaction, never a direct write.

**Enforced by:** `src/mutation_policy.ts`, `src/skills_pipeline.ts`, strict
authority-pattern validation, carrier matrix tests, precedence tests,
`tests/skills_authority.test.ts`, and complete decision-ledger checks.

### INV-019: Central metadata index bytes are canonical and self-excluding

The repository metadata index is `.l9/metadata-index.jsonl`. Every non-`hard_skip`
record is canonical JSON, sorted by repository-relative POSIX path, recursively
sorts metadata keys, requires a lowercase SHA-256 content hash, contains no
absolute paths or run-time report fields, and ends with one newline. Normal
discovery records `.l9` as generated state and never descends into it. Unchanged
index bytes are not rewritten. Adjacent sidecars and inject logs are disabled by
default and require explicit opt-in.

**Enforced by:** `src/metadata_index.ts`, `src/retrieval.ts`, metadata-index
schema validation, dual-order determinism tests, symlink-containment tests, and
idempotent write tests.

### INV-020: Governed check and apply share one carrier plan

Check and apply must consume the same path-sorted carrier decisions and canonical
metadata-index compilation. `central_manifest` and `inventory_only` never create
adjacent sidecars or source annotations. `inline_managed` requires an explicitly
authorized YAML-frontmatter subject whose target is the source path. Skills mode
recognizes only the canonical `SKILL.md` basename.

**Enforced by:** `src/carrier_operation.ts`, `src/apply.ts`, carrier-operation
tests, exact-skill-entrypoint tests, and apply-dispatch source-contract tests.

### INV-021: Apply is whole-run transactional

Every changed inline carrier and the canonical metadata index must enter one immutable
file transaction. All originals are compare-and-swap checked, replacements are staged
beside their targets, backups survive through post-commit validation, and any failure
restores the complete set. Interrupted journals are recovered before a new plan runs.

**Enforced by:** `src/file_transaction.ts`, `src/apply.ts`, fault-injection rollback
tests, concurrent-drift tests, symlink-containment tests, and recovery tests.

### INV-022: Inline frontmatter is byte-preserving and fail-closed

Only plain Markdown is an ordinary YAML-frontmatter carrier. Managed updates preserve
the BOM, header newline convention, document body, comments, key order, whitespace,
and unrelated values. Duplicate, ambiguous, or complex YAML is never normalized or
rewritten automatically. Skills mode patches only fields with material diffs.

**Enforced by:** `src/frontmatter_patch.ts`, `src/inject.ts`,
`src/skills_pipeline.ts`, exact-fence tests, byte-preservation tests, unsafe-YAML
refusal tests, and MDX/RST carrier tests.

## Source and distribution

### INV-004: Source and committed distribution are identical in meaning

Every shipped JavaScript file, declaration, and source map under `dist/` must be generated from the committed TypeScript source. Missing, extra, changed, untracked, or symlinked distribution files are forbidden.

**Enforced by:** `npm run check:dist`, `npm run validate`.

### INV-005: The installed tarball is the tested product

The npm artifact must satisfy the package path contract, install into a clean consumer, execute each supported runtime entrypoint, compile each declaration entrypoint, and reject unsupported deep imports.

**Enforced by:** `npm run test:packed`, `docs/package-contract.json`, `prepack`.

### INV-006: Architecture evidence is content-bound

Authority-critical files must match `docs/architecture-manifest.json`. Any change to `docs/architecture.md` or another listed path requires deterministic manifest regeneration.

**Enforced by:** `npm run manifest:update`, `npm run check:manifest`.

## Validation and CI

### INV-007: The canonical aggregate gate is `npm run validate`

The aggregate gate must continue to cover source typing, Vitest, public API, architecture authority, architecture manifest, distribution parity, selfpack, and packed-consumer proof.

ESLint is additive and remains a separate local command and CI context.

**Enforced by:** `package.json`, `.github/workflows/ci.yml`, `.github/workflows/l9-lint-test-node.yml`.

### INV-008: Validation leaves the checkout clean

Validation must not rewrite tracked files or leave untracked output in the repository.

**Enforced by:** the `CI / smoke` clean-checkout step.

### INV-009: Provider reports are normalized before policy judgment

The raw Semgrep process may return findings without terminating the report-production step. The normalized bundle and governed publication path own the final policy result.

**Enforced by:** `.github/workflows/l9-analysis.yml`, pinned L9 Core actions.

### INV-010: Supply-chain jobs use least privilege and immutable references

Reusable workflows and external actions remain pinned to full commit SHAs. Job permissions stay no broader than required.

**Enforced by:** workflow review and CI execution.

## Release and publication

### INV-011: Packing and publishing are different decisions

A package may build, validate, and pack while publication remains blocked. `npm publish` must fail closed until every required external evidence item is resolved and owner approval is recorded.

**Enforced by:** `prepublishOnly`, `npm run check:publication`, `docs/package-publication-decision.json`.

### INV-012: Unknown is not approval

Unknown branch-protection state, unknown consumer inventory, unknown registry history, and unknown distribution approval must remain explicitly unknown. Documentation and automation must not convert absence of evidence into success.

### INV-013: Architecture decisions are append-only

Accepted ADRs remain in the repository. A changed decision receives a new sequential ADR, and superseded records link forward and backward. ADR rationale must remain consistent with active machine contracts or the discrepancy is treated as drift.

**Enforced by:** documentation review, `docs/decision_log.md`, and the ADR pack validator.

## Enforcement map

| Invariant | Primary gate |
|---|---|
| INV-001 | `npm run check:authority` |
| INV-002 | `npm run check:api` and `npm run test:packed` |
| INV-003 | Vitest and selfpack |
| INV-004 | `npm run check:dist` |
| INV-005 | `npm run test:packed` |
| INV-006 | `npm run check:manifest` |
| INV-007 | `npm run validate` plus `npm run lint` |
| INV-008 | `CI / smoke` clean-checkout proof |
| INV-009 | L9 Analysis normalize/validate/publish chain |
| INV-010 | Workflow pin and permissions review |
| INV-011 | `npm run check:publication` |
| INV-012 | Evidence and repository-setting verification |
| INV-013 | Decision-log and ADR review |
| INV-014 | Operation-contract, public API, and packed-consumer tests |
| INV-015 | Read-only check integration and recursive snapshot tests |
| INV-016 | Operation-dispatch, path-containment, shell-boundary, and immutable-Action tests |
| INV-017 | Deterministic identity, complete discovery ledger, and strict omit-source tests |
| INV-018 | Explicit carrier-policy precedence, authority-pattern, and coverage tests |
| INV-019 | Canonical JSONL, .l9 isolation, no-rewrite idempotency, and auxiliary-write default tests |
| INV-020 | Shared carrier-plan, no-sidecar dispatch, authorized-inline, and exact SKILL.md tests |
| INV-021 | Multi-file transaction, rollback, concurrent-drift, validation-failure, and recovery tests |
| INV-022 | Frontmatter byte-preservation, idempotency, unsafe-YAML refusal, and carrier-extension tests |
| INV-023 | Release identity, immutable-ref, packed-CLI, and consumer single-writer migration tests |
| INV-024 | Corpus source-versus-analysis identity, verification-class, and partial-corpus tests |
| INV-025 | Document decoding, reported work, generational publication, and bound evidence tests |
| INV-026 | Block-bound work-signal, per-format decoder-identity, and reuse-parity tests |

### INV-023: Releases and consumer migrations use immutable identity

Package, lockfile, changelog, release plan, and packed executable must agree on one semantic version. Consumer automation pins the final 40-character release commit and removes every competing writer before canonical apply. npm publication is a separate authorization and may remain blocked without blocking GitHub commit consumption.

**Enforced by:** `scripts/check-release-candidate.js`, release contract tests, the PR-5 exact-checkout runner, and the l9-deploy migration installer.

### INV-024: A corpus says what it observed, under which rules, and how it knows

A corpus carries two identities. `corpus_source_snapshot_id` is derived from the
roots' ids, source revisions and Repository Model Packet ids alone; no analysis
profile enters it. `corpus_analysis_id` binds that plus every profile the derived
layers were computed under. Changing a decoder, threshold or model moves the
second and never the first, and `corpus_id` is a label that enters neither.

Every observed root emits its own Repository Model Packet, canonically identical
to the packet the single-source path produces for that root, so conformance proven
for a single-source bundle covers every per-root corpus bundle.

A content hash records how it was obtained. `verification_class` is
`fully_verified` only when every byte was read on that run; reuse of a single
prior hash under `--incremental` makes the whole snapshot
`cached_unchanged_assumption`. No optimization may upgrade a weaker evidence class
into byte verification.

A root that could not be read fails the run unless `--allow-partial-roots` is
given, and a partial corpus is recorded as `partial` with the missing root named —
never as complete.

A cached interpretation carries no subject-bound identity; subject and assertion
ids are derived for whichever root reads the entry, so two roots holding identical
bytes at identical relative paths cannot absorb each other's artifacts.

**Enforced by:** `tests/corpus_identity.test.ts`, `tests/corpus_verification.test.ts`,
`tests/corpus_diff.test.ts`, `tests/corpus_cache.test.ts`, and the scale and
real-corpus qualification suites.

### INV-025: A reported number was measured, and a whole result set appears at once

A decoder that opened a document is not the claim; what came out of it reaching
the analysis is. Prose document formats — PDF, DOCX, PPTX, XLSX, IPYNB, CSV,
HTML — enter lexical analysis on format rather than extension, and
`document-signals.json` reports per format how many of its documents were
decoded, analyzed and named by a candidate. A format with a decode count above
zero and a participation count of zero is a defect this document exists to make
visible.

Every block cites a coordinate its own format has. No format without lines is
given a line number, and a decoder that cannot read a document returns a typed
reason — `decoder.ocr_required`, `decoder.encrypted`, `decoder.malformed` — never
an empty document. No notebook cell is executed, no spreadsheet formula
evaluated, no macro or script run, and no reference declared inside a document is
fetched.

A count is computed or it is `null` with a stated reason. Candidate deltas come
from each snapshot's analysis manifest; when a snapshot has none, all four counts
are null and `not_computed_reason` says which case it is. Zero means two manifests
were compared and matched. `decode_gap` reconciles the eligible set against the
decoded one with an `unaccounted` residual, so a document lost by an unnamed route
is reported rather than absorbed.

A budget bounds the run or it does not exist. A flag that is recorded and
exercised nowhere is removed, and an invocation still passing it is refused by
name rather than ignored.

Candidate pair work is bounded by an exact filter rather than a sample, and the
work done is reported beside what comparing everything would have cost. A bounded
pass must agree exactly with an exhaustive one.

Output is published generationally: every projection of one run is written into
one directory and a single atomic rename of `CURRENT.json` makes the set visible.
No reader may observe one run's coverage report beside another run's readiness
document. Cache and session writes are staged, fsynced, renamed, and the parent
directory fsynced, because a rename is atomic against a crashed process and not
against a power cut.

A root identity states whether it was declared or inferred, and a longitudinal
comparison resting on an inferred key raises a caution rather than an unqualified
claim of continuity.

Evidence is bound to what it describes. A validation report names a digest of the
tree it ran over and is invalid the moment that tree moves; a conformance record
names the exact bytes of every bundle it accepted; a real-archive acceptance run
scans the roots an operator declared and never discovers one.

**Enforced by:** `tests/corpus_document_participation.test.ts`,
`tests/document_decoders.test.ts`, `tests/corpus_candidate_diff.test.ts`,
`tests/corpus_concurrency.test.ts`, `tests/corpus_topic_scale.test.ts`,
`tests/corpus_scale.test.ts`, `tests/corpus_publish.test.ts`,
`tests/corpus_root_identity_durability.test.ts`,
`tests/corpus_real_archive_acceptance.test.ts`,
`tests/topology_readonly_guard.test.ts`, and `tests/validation_report.test.ts`.

### INV-026: A decoded document states what it says, at a coordinate it has

Every supported format is read with one vocabulary. A status, a kind, a task, a
milestone and a declared relation are recognized by a single implementation, so
the same sentence in a `.docx` and in the `.md` copy beside it produces the same
claim. A format is never reported as having said nothing because of the program
it was written in.

A claim cites the coordinate its own source has. A file with lines cites a line
span; a decoded document cites its block id and the structured locator its
decoder emitted — a slide and a shape, a sheet and a cell, a page and a block, a
row and a column. No block-bound claim cites a line span. Block-bound evidence
binds the artifact id, the raw content hash, the normalized document id, the
decoder and its version, the block, the locator, a bounded excerpt, the predicate
and the object; it reaches readiness, the semantic passes, coverage, the corpus
index and the report, and it does not reach the Repository Model Packet, whose
evidence class is a line span.

An identity names what produced it. A document entry names the decoder that read
those bytes and the format it read them as, and its normalized document id is
derived from that decoder — never from a fixed one — because that id joins the
index, the cache and every piece of evidence, and three things that must agree
cannot be computed from a decoder that did not run.

Reuse lands on the same answer. An observation recorded when a file is hashed is
recorded when a prior run's hash is carried forward, so an incremental scan of an
unchanged disk produces the inventory a full scan of those exact bytes produces,
and neither the packet semantic hash nor the corpus source snapshot id moves for
a corpus nobody touched.

The report distinguishes the two failures. Exact observation, per-format decoding
with eligible beside decoded beside understood, intelligence and embedding are
stated in `corpus-report.md`, so "we inspected this and found nothing" and "we
could not understand this" are different rows rather than one total. Where a
listing is bounded, the complete count and the omitted count are both stated.

**Enforced by:** `tests/corpus_document_work_signals.test.ts`,
`tests/corpus_document_participation.test.ts`,
`tests/local_source_safety.test.ts`, `tests/corpus_cli.test.ts`,
`tests/corpus_scale.test.ts`, and `tests/corpus_scale_incremental.test.ts`.
