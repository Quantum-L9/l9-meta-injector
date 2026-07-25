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
