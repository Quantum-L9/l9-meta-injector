# ADR-030: Skills mode requires repository authority and commits transactionally

## Status

Accepted.

## Related

- Amends the authority scope of [ADR-019](019-canonical-operation-and-authority-contracts.md) and [ADR-020](020-fail-closed-repository-authority-scan.md), which enumerated only `check` and `apply` as authority-gated operations.
- Extends the governed carrier-mutation and whole-run transaction decisions of [ADR-024](024-explicit-metadata-carrier-policy.md) and [ADR-027](027-whole-run-transactional-apply.md) to the skills entrypoint.
- Realizes the standing invariant [INV-018](../../INVARIANTS.md) ("Skills mode does not bypass repository authority").
- Preserves the skills feature scope of [ADR-017](017-omit-skill-protect-skills-mode.md).

## Context

ADR-019 defined four canonical operation modes and made `check` and `apply` the operations that require a `.l9/meta-authority.yaml` declaration; ADR-020 blocked those two operations when authority was missing, mismatched, or contested. INV-018 separately requires that skills mode not bypass repository authority.

The shipped skills runtime did not honor that invariant. `operationRequiresAuthority("skills")` returned `false`, the CLI and action dispatch never carried an authority input into skills, and `runSkillsPipelineAsync` wrote each changed `SKILL.md` with a direct `fs.writeFileSync`, outside the governed compare-and-swap transaction that `apply` uses. A runtime-enforcement audit (2026-08-13) confirmed the gap: any caller of the package API, CLI, or action could mutate protected skill entrypoints with no authority check and no transactional safety. The authority requirement was split between the older operation contract and the later invariant, and the operation-contract test locked in the stale rule.

## Options Considered

### Option A: Flip only the authority boolean

- Pros: smallest change.
- Cons: leaves a second, independent filesystem-commit path for protected repository files; a programmatic caller still bypasses transactional guards. Rejected.

### Option B: Rewire skills through the full carrier planner

- Pros: maximal reuse of `planCarrierOperationAsync`.
- Cons: discards the skills-specific description/activation-signal materiality logic and materially changes behavior beyond the defect. Higher risk. Rejected for this change.

### Option C: Gate skills on authority and route its writes through the shared transaction, keeping its content decisions

- Pros: closes both halves of the defect (authority + commit boundary) while preserving skills' materiality behavior; a single enforcement rule holds for the package API, CLI, and action.
- Cons: adds authority setup to skills callers and tests.

## Decision

We choose **Option C**.

1. `operationRequiresAuthority("skills")` returns `true`. `inventory` remains read-only and non-authoritative.
2. Before any protected mutation, `runSkillsPipelineAsync` recovers pending transactions and inspects canonical repository authority against the canonical writer, failing closed (no discovery, no write) when authority is missing, malformed, mismatched, or contested. The check lives inside the reusable runtime entrypoint, not only in wrappers, because callers can invoke the pipeline directly.
3. Skills no longer performs direct target writes. It plans compare-and-swap mutation intents from the exact bytes observed at plan time and commits them through `executeFileTransaction` with a post-commit validation callback, inheriting the same staging, path/symlink guards, compare-and-swap, whole-run rollback, and journal recovery as `apply`.
4. The CLI (`scripts/skills-cli.js`) and the action/CLI dispatch (`scripts/lib/operation-dispatch.js`) require and forward an explicit `--authority` input for skills, matching `check` and `apply`.
5. Dry-run remains a read-only preview: it never mutates and keeps its prior semantics, so it is not fail-closed on absent authority.

## Consequences

- Skills mode is a governed specialization of the canonical mutation path; there is no second protected-write mechanism.
- Every skills entrypoint — package API, CLI, and action — traverses the same mandatory authority control.
- Skills callers must declare `.l9/meta-authority.yaml`; tests establish it explicitly.
- Negative authority tests, a multi-file transactional commit test, and a dry-run preview test are added; the obsolete "skills does not require authority" expectation is replaced.
- Committed `dist/` is rebuilt from source and the architecture manifest is regenerated in the same change.
