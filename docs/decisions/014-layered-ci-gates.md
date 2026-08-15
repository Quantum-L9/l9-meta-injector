# ADR-014: Use layered CI with a canonical aggregate gate and independent contexts

## Status

Accepted (retrospective)

## Date

2026-07-23

## Context

The repository needs fast, legible check contexts for linting, typing, and tests, while also requiring a complete package-integrity proof that covers architecture contracts, generated distribution, selfpack behavior, and installed-tarball consumption. Security analysis and supply-chain evidence have different permissions and event needs from first-party package validation.

A single workflow can hide which concern failed. Fully separate workflows can omit the integrated proof that all package constraints hold together.

## Options Considered

### Option A: Use one monolithic smoke job for every concern

- Pros: one command and one required context; simple branch-protection setup.
- Cons: poor failure isolation; security and supply-chain permissions become entangled; later steps may not run after an early failure; independent policy contexts disappear.

### Option B: Use only independent lint, type, test, analysis, and supply-chain jobs

- Pros: clear failure ownership; jobs can run in parallel; permissions remain narrow.
- Cons: no single proof that the complete package validation chain succeeds; distribution and packed-consumer checks can be missed or inconsistently composed.

### Option C: Combine a canonical aggregate smoke gate with independent first-party and governed evidence jobs

- Pros: preserves complete package proof; exposes independent ESLint, typecheck, and Vitest contexts; isolates governed analysis and supply-chain permissions; supports parallel diagnosis.
- Cons: some checks run more than once; branch-protection contexts require explicit external configuration; documentation must distinguish raw provider capture from final policy judgment.

## Decision

We choose **Option C**. `CI / smoke` runs the canonical `npm run validate` chain and proves the checkout remains clean. Independent `ESLint`, `tsc --noEmit`, and `Vitest` contexts provide fast failure isolation. L9 Analysis owns normalized Semgrep evidence, and L9 Supply Chain owns Scorecard and SBOM evidence.

## Consequences

- Duplicate execution of typing and tests is accepted for clarity and integrated proof.
- ESLint remains an additive gate outside `npm run validate` unless a future ADR changes the canonical command.
- Raw Semgrep execution may preserve findings for normalization without making the governed result advisory.
- Workflow presence does not prove branch-protection enforcement; repository settings must be verified separately.
- External actions and reusable workflows remain pinned to immutable commit SHAs with least-privilege permissions.
