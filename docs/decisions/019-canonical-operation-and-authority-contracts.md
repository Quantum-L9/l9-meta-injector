# ADR-019: Canonical operation and repository-authority contracts

- Status: Accepted
- Date: 2026-08-01
- Supersedes: none
- Related: ADR-010, ADR-013, ADR-017, ADR-018

## Context

The TypeScript pipeline is the sole active engine, but invocation surfaces currently
use overlapping terms and permit mutation without a repository-owned authority
contract. The composite Action also treats unrecognized modes as inventory. That
makes operational intent ambiguous at the exact boundary where mutation must be
explicit and fail closed.

## Decision

The canonical operation modes are:

1. `inventory`: read-only classification and reporting.
2. `check`: read-only expected-versus-actual drift evaluation.
3. `apply`: explicit mutation under repository authority.
4. `skills`: specialized skill-entrypoint editing.

`pipeline` is a deprecated compatibility alias for `apply`; unknown values are
errors and never fall back to another mode.

Repositories participating in `check` or `apply` must declare
`.l9/meta-authority.yaml` using schema `l9.meta-authority/v1`. The declaration names
the sole writer, pins its ref, selects the default carrier, forbids or bounds legacy
writers, and lists paths eligible for managed inline metadata.

This ADR introduces contracts only. The existing TypeScript engine remains the sole
runtime. Authority scanning, read-only check orchestration, carrier policy, and
transactional apply are implemented in subsequent changes against these contracts.

## Consequences

- Operational intent becomes exhaustive and machine-checkable.
- Unknown modes and unsupported authority schemas fail closed.
- `inventory` remains usable before authority adoption.
- `check` and `apply` cannot silently assume `l9.doctrine.platform` authority.
- Existing callers retain `runPipelineAsync` during the compatibility window.
- Public API and packed-consumer contracts expand and require synchronized `dist/`.

## Rejected alternatives

- Keep `pipeline` as the canonical mutating name: it obscures mutation intent.
- Infer authority from repository ownership: absence of evidence is not approval.
- Add a second orchestration engine: this would violate the one-engine invariant.
