# ADR-048: Organization L9 CI is centrally required, and the consumer owns no Core or SDK revision

## Status

Accepted

Amends [ADR-014](014-layered-ci-gates.md): the `CI / smoke` aggregate gate and the
independent `ESLint`, `tsc --noEmit`, and `Vitest` contexts stand unchanged; the
`L9 Analysis` and `L9 Supply Chain` contexts that ADR-014 assigned to repository
workflows are replaced by the organization-required workflow described here.

## Date

2026-09-05

## Context

Until this decision the repository carried two consumer-owned copies of organization
CI. `.github/workflows/l9-analysis.yml` was a caller derived from the Core template:
it declared `L9_CORE_REF`, ran Semgrep locally, and invoked seven
`Quantum-L9/l9-ci-core` actions and one reusable workflow at a full Core SHA.
`.github/workflows/l9-supply-chain.yml` delegated SBOM and OpenSSF Scorecard to two
Core reusable workflows at a second, older Core SHA. Both files existed solely to
execute organization L9 CI, and both made this repository the owner of a Core
revision: every Core change reached this repository only through a manual SHA bump,
which is why the two files had already drifted to different Core commits.

`Quantum-L9/l9-ci-core` `main` now carries `.github/workflows/org-ci.yml`
(`l9.org-runtime-contract/v1`). A GitHub organization ruleset requires that workflow
on targeted repositories, and it already executes here: the `Analyze (central Core)`
check ran and passed on this repository's most recent pull request before any file in
this tree referenced it. The central workflow resolves governance from
`@core-defaults`, provisions the SDK itself, and reads from the consumer only the
optional `.l9/ci.json` (`owner`, `repo_class`, `waiver_refs`), which this repository
already declares.

The Core contract states the target directly: consumer repositories do not copy L9
workflows, governance packs, Core pins, SDK pins, or enforcement modes.

## Options Considered

### Option A: Keep the copied caller and the delegating supply-chain workflow, and bump their Core SHAs

- Pros: nothing changes in the tree; the checks keep their current names.
- Cons: the consumer stays the owner of a Core revision; every Core change needs a
  consumer PR; the two files run organization analysis twice (once locally, once
  centrally) with different Core commits; the consumer-owned copy can lag or diverge
  from the organization policy indefinitely.

### Option B: Replace the pinned references with the floating `@v2` tag

- Pros: fewer manual bumps.
- Cons: still a consumer-selected Core runtime dependency; `@v2` is the consumer
  toolchain-installer tag, not the organization-enforcement path; the copied caller
  still duplicates the central run.

### Option C: Remove consumer-owned organization CI and rely on the organization required workflow

- Pros: one execution of organization CI, from `l9-ci-core` `main`, selected by the
  organization control plane; zero consumer work when Core changes; the consumer
  declares configuration (`.l9/ci.json`) and owns only its own CI.
- Cons: the repository can no longer prove organization CI from its own tree, so
  documentation must point at the ruleset; the two removed workflows' check names
  disappear and any branch-protection rule naming them must be re-pointed at
  `Analyze (central Core)`.

## Decision

We choose **Option C**.

- `.github/workflows/l9-analysis.yml` and `.github/workflows/l9-supply-chain.yml` are
  deleted. With them go `L9_CORE_REF` and every `uses: Quantum-L9/l9-ci-core/...@<SHA>`
  reference. The repository selects neither a Core nor an SDK revision.
- Organization L9 CI is executed by the GitHub organization required-workflow ruleset
  from `Quantum-L9/l9-ci-core` `main` `.github/workflows/org-ci.yml`. Core owns
  orchestration, governance defaults, SDK admission, enforcement, and publication.
- `.l9/ci.json` remains the only consumer-owned L9 CI declaration. `.github/governance/`
  is retained as declarative reference content until Core confirms it holds nothing
  the central defaults lack; no workflow in this tree reads it.
- `ci.yml`, `l9-lint-test-node.yml`, and `l9-llm-selftest.yml` are repository-owned
  and unchanged. The `L9` prefix in a filename does not make a workflow organization
  CI; behavior does.
- No copied or delegating L9 organization workflow, `L9_CORE_REF`, `L9_SDK_REF`, Core
  SHA pin, Core `@v2` runtime reference, or Core/SDK bump automation may be added
  back. A Core change is consumed at the next pull request or merge-group run with
  no edit here.

## Consequences

- Organization analysis runs once, centrally, at `blocking` under Core's defaults
  rather than under a consumer-selected profile.
- SBOM and Scorecard evidence is no longer produced by a workflow in this tree.
  Whether Core's `supply_chain` execution class covers it for this repository is a
  Core and control-plane question; it is recorded here as a removed consumer
  capability, not as a Core guarantee.
- Branch-protection required contexts are repository settings outside the tree. Any
  rule that named `Analyze (semgrep -> SDK)`, `Publish analysis (Core)`, `SBOM`, or
  `OpenSSF Scorecard` must be re-pointed at `Analyze (central Core)`; INV-012 keeps
  that state explicitly unknown until inspected.
- Rollback of a bad Core change happens in Core, not by restoring a consumer pin.
- `AGENTS.md`, `CLAUDE.md`, `INVARIANTS.md` (INV-009), and `docs/architecture.md`
  describe the organization-required workflow instead of the removed files, and the
  architecture manifest is regenerated for the changed authority document.
