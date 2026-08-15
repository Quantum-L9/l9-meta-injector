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
(ADR-031): it fails closed without resolved authority and commits `SKILL.md`
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

### INV-023: Releases and consumer migrations use immutable identity

Package, lockfile, changelog, release plan, and packed executable must agree on one semantic version. Consumer automation pins the final 40-character release commit and removes every competing writer before canonical apply. npm publication is a separate authorization and may remain blocked without blocking GitHub commit consumption.

**Enforced by:** `scripts/check-release-candidate.js`, release contract tests, the PR-5 exact-checkout runner, and the l9-deploy migration installer.
