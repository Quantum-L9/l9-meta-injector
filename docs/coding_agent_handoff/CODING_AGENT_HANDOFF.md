# Coding Agent Handoff — GMP v2.0 Execution Pack

**Package:** l9-meta-injector  
**Target repo:** https://github.com/Quantum-L9/l9-meta-injector  
**Generated:** 2026-07-04  
**Push performed:** false

## Purpose

This folder equips a coding agent to execute the l9-meta-injector upgrade plan through GMP-style phased execution. It does not replace the repo's build plan; it wraps the plan with phase-specific execution prompts and handoff rules.

## Source Skill / Prompt System Added

Path: `docs/coding_agent_handoff/gmp_v2_prompt_system/`

Included uploaded files:

- `README.md`
- `phase-0-prompt.md`
- `phase-2-3-4-prompt.md`
- `phase-5-prompt.md`
- `phase-6-prompt.md`
- `ai-to-ai-handoffs.md`

Declared by source README but not uploaded in this turn:

- `gmp-system-prompt.md` — Unknown / missing
- `learning-integration-prompt.md` — Unknown / missing
- `gmp-quick-reference.md` — Unknown / missing

## How the Coding Agent Should Use This

1. Read root `README.md`, `docs/build_plan.md`, and this handoff.
2. Load `gmp_v2_prompt_system/README.md` for the prompt-system map.
3. Use `phase-0-prompt.md` to create a locked TODO plan for exactly one GMP chunk.
4. Execute only after the operator approves the locked Phase 0 plan.
5. Use `phase-2-3-4-prompt.md` during implementation, guard creation, and validation.
6. Use `phase-5-prompt.md` for recursive verification.
7. Use `phase-6-prompt.md` to produce final report, rollback plan, and integration instructions.
8. Use `ai-to-ai-handoffs.md` only for optional multi-agent learning/handoff guidance. Do not invent a learning engine if it is not present in the repo.

## Required Execution Order

1. GMP-001: Add `npm run validate`
   - Highest leverage.
   - Creates one command gate for all future chunks.
2. GMP-002: Modernize Jest config
   - Low risk.
   - Removes known warning noise.
3. GMP-003: Resolve npm audit warning
   - Do after validation script exists.
   - Block if fix changes runtime behavior.
4. GMP-004: Public API boundary decision
   - Decide what is public vs internal before hardening docs/exports.
5. GMP-005: Dry-run/write-safety tests
   - Protects package behavior before deeper changes.
6. GMP-006: Mocked LLM adapter tests
   - Verifies the important edge without real network dependency.
7. GMP-007: CI workflow
   - Only after local validation is stable.
8. GMP-008: Package consumer fixture
   - Confirms external usability.
9. GMP-009: Release checklist / publish readiness
   - Last, because it depends on the previous gates.

## Guardrails

- Do not push.
- Do not execute multiple GMP chunks in one run unless the operator explicitly approves.
- Do not modify unrelated L9-Ops-MCP scope.
- Do not fake learning-engine logging. If learning-engine files/env vars are absent, mark logging as skipped/Unknown.
- Do not treat the uploaded GMP prompts as proof that the repo has DORA or learning-engine implementation.
- Preserve package identity: `l9-meta-injector`.
- If validation cannot run, stop and report the exact blocker.

## First Chunk Recommendation

Start with **GMP-001: Add `npm run validate`**.

Minimum expected output for GMP-001:

- `package.json` script added: `validate`
- validation command composed from existing repo commands only
- tests still pass
- `npm run validate` passes
- GMP report added under `reports/`
- local commit only

## Embedded Build Plan

# L9 Meta Injector Build Plan

**Package:** `l9-meta-injector`  
**Repo target:** `https://github.com/Quantum-L9/l9-meta-injector`  
**Source plan:** `l9_meta_injector_upgrade_plan_v2_revised.md`  
**Status:** execution-ready plan artifact, not yet executed  
**Generated/embedded:** 2026-07-04  

## Purpose

This document embeds the generated build plan and the operator-approved execution order directly into the commit pack so future agents can execute the upgrade campaign without hunting through chat history.

## Execution Doctrine

- Use `l9-build-contract-compiler` after `l9-plan` when a plan needs a build contract suite.
- Execute each GMP chunk through `l9-gmp-protocol` with a locked Phase 0 TODO plan, validation evidence, and one local commit per chunk.
- Do not push unless explicitly instructed.
- Do not bundle unrelated GMPs into a mega-run.
- Treat license choice, public/internal API decisions, and remote CI proof as explicit decision/Unknown gates.

# Recommended Execution Order — Operator Override

This order is the current execution sequence for the upgrade campaign. It supersedes earlier sequencing where it differs.

1. **GMP-001: Add `npm run validate`**
   - Highest leverage.
   - Creates one command gate for all future chunks.
2. **GMP-002: Modernize Jest config**
   - Low risk.
   - Removes known warning noise.
3. **GMP-003: Resolve npm audit warning**
   - Do after validation script exists.
   - Block if fix changes runtime behavior.
4. **GMP-004: Public API boundary decision**
   - Decide what is public vs internal before hardening docs/exports.
5. **GMP-005: Dry-run/write-safety tests**
   - Protects package behavior before deeper changes.
6. **GMP-006: Mocked LLM adapter tests**
   - Verifies the important edge without real network dependency.
7. **GMP-007: CI workflow**
   - Only after local validation is stable.
8. **GMP-008: Package consumer fixture**
   - Confirms external usability.
9. **GMP-009: Release checklist / publish readiness**
   - Last, because it depends on the previous gates.


---

# PLAN: L9 Meta Injector Maximum-Leverage Upgrade Plan v2

**Target repo:** `/mnt/data/l9-meta-injector-final`  
**Package:** `l9-meta-injector`  
**Mode:** `plan + chunk` using revised `l9-plan`  
**Mutation:** none  
**Source reports:** four diagnostic skill reports plus v1 upgrade plan  
**Generated:** 2026-07-04

## Objective

Convert the four diagnosis reports into an execution-ready, GMP-chunked upgrade plan that maximizes leverage while preserving the package's meta-injector scope. The goal is not to rebuild the repo. The goal is to remove publish friction, harden public contracts, strengthen write-path safety, isolate networked behavior, and make future changes provably safe through validation automation.

Success means:

- license and publish metadata are explicit;
- Jest/ts-jest warnings are removed;
- dependency risk is resolved or consciously accepted;
- `src/compiler.ts` public/internal status is decided;
- write-path and LLM-adapter safety are test-backed;
- one-command validation exists;
- CI is ready for remote use after push;
- every implementation unit is sized with a GMP chunking matrix rather than a fixed tiny slice.

## Scope

**In:**

- publish readiness and package trust;
- dependency/audit hygiene;
- Jest config modernization;
- public API boundary hardening;
- dry-run/outDir write-safety tests and docs;
- OpenAI-compatible adapter mocked test coverage;
- one-command validation script;
- CI workflow prep;
- release checklist;
- package consumer fixture if it does not create disproportionate harness complexity.

**Out:**

- L9-Ops-MCP graph export adapter work;
- web/API route implementation;
- npm publishing;
- remote push or PR creation;
- broad architecture rewrite;
- changing core behavior without test evidence;
- guessing license choice;
- live-network LLM tests requiring real credentials.

## Source Grounding

| Source | What It Proves | Confidence |
|---|---|---|
| `docs/skill_runs/gap_analysis.md` | remaining gaps are license clarity, one moderate npm audit warning, and Jest config modernization; build/test/package readiness is already 100% | high |
| `docs/skill_runs/code_analysis.md` | package is a coherent TypeScript library/toolkit; hotspots are runtime-networked LLM adapter, file-writing injection path, and ts-jest warning | high |
| `docs/skill_runs/component_verification.md` | all public components are exported except `src/compiler.ts`, whose public/internal intent is Unknown | high |
| `docs/skill_runs/api_smoke_testing.md` | there is no API/server route surface; API smoke testing is not applicable | high |
| `docs/skill_runs/SKILL_RUN_SUMMARY.md` | validation baseline passed: typecheck, 9 Jest suites / 66 tests, npm pack dry-run | high |
| `l9_meta_injector_upgrade_plan.md` | v1 plan identified correct tracks and priorities but lacked GMP matrix sizing and stronger handoff structure | high |

## Prioritized Work

| # | Task | Files | Effort | Risk | Label |
|---:|---|---|---|---|---|
| 1 | Finalize package license and publish metadata | `LICENSE_NOTE.md`, `LICENSE`, `package.json`, `README.md` | S | medium, because license is business/legal | blocked until license choice |
| 2 | Modernize Jest/ts-jest config | `jest.config.js`, tests only if needed | S | low | single-gmp |
| 3 | Resolve or document npm audit warning | `package.json`, `package-lock.json`, `VALIDATION_REPORT.md` or `docs/validation.md` | S/M | medium | single-gmp |
| 4 | Decide and lock `src/compiler.ts` public/internal status | `src/index.ts`, `src/compiler.ts`, `README.md`, `tests/public_api.test.ts` | S/M | medium | single-gmp after decision |
| 5 | Add public API surface regression test | `tests/public_api.test.ts`, possibly `src/index.ts` | S | low | single-gmp |
| 6 | Harden injection dry-run/outDir behavior | `src/inject.ts`, `tests/inject*.test.ts`, `README.md`, `examples/` | M/L | medium | single-gmp or multi-gmp depending findings |
| 7 | Add OpenAI-compatible adapter mocked tests | `src/llm.ts`, `tests/llm*.test.ts` | M | medium | single-gmp |
| 8 | Add one-command local validation | `package.json`, `README.md`, `VALIDATION_REPORT.md` | S | low | single-gmp |
| 9 | Add CI workflow | `.github/workflows/ci.yml`, `README.md` or `docs/release_checklist.md` | S | low locally, medium remote-only proof | single-gmp |
| 10 | Add package consumer fixture | `tests/package_consumer.test.ts` or `fixtures/consumer/` | M/L | medium | single-gmp if simple; split if fixture infra grows |
| 11 | Add release checklist | `docs/release_checklist.md`, `CHANGELOG.md`, `README.md` | S | low | single-gmp |

## Dependencies

```text
License decision ─┬─> package metadata ──> release checklist
                  └─> npm pack metadata validation

Jest modernization ──> stable test output ──> CI workflow

Dependency audit ────> validate script/audit gate decision

compiler.ts decision ──> public API test ──> component verification clean

Injection safety tests ──> README safety block ──> dry-run example

LLM mock tests ──> adapter refactor only if needed

validate script ──> CI workflow ──> release checklist
```

## GMP Chunk Map

This uses the revised matrix model. Default target is `M`; use `L` only when the files are tightly coupled and rollback remains one clean revert. No `XL` chunk is justified yet because the findings are finite and not architecturally entangled.

| GMP | Tier | Objective | Files | Validation | Rollback |
|---|---|---|---|---|---|
| GMP-001 | S | Modernize Jest config and remove ts-jest warning | `jest.config.js`; tests only if needed | `npm test`, `npx jest --runInBand`, `npm run typecheck` | revert one commit |
| GMP-002 | S/M | Resolve or explicitly document npm audit warning | `package.json`, `package-lock.json`, validation/report docs if accepted risk | `npm audit --audit-level=moderate`, `npm test`, `npm run typecheck`, `npm pack --dry-run` | revert dependency lock/package changes |
| GMP-003 | S | Add one-command validation script | `package.json`, `README.md` | `npm run validate`; underlying commands pass | revert one commit |
| GMP-004 | S/M | Lock public API surface and resolve `compiler.ts` intent | `src/index.ts` if exporting, `README.md`, `tests/public_api.test.ts`, optionally `src/compiler.ts` doc comments | `npm run typecheck`, `npm test`, targeted public API test | revert one commit; if export added, this is public-contract rollback |
| GMP-005 | M/L | Harden injection write-safety behavior with regression tests and docs | `src/inject.ts` if needed, `tests/inject*.test.ts`, `README.md`, `examples/dry_run.ts` | targeted inject tests, full Jest, typecheck, pack dry-run | revert one commit; no data migration |
| GMP-006 | M | Add mocked LLM adapter coverage without live network | `src/llm.ts` if injection seam needed, `tests/llm*.test.ts`, README credential note if missing | targeted LLM tests, full Jest, typecheck | revert one commit; no external credentials involved |
| GMP-007 | S/M | Add CI workflow using existing local gates | `.github/workflows/ci.yml`, `README.md` or `docs/release_checklist.md` | local YAML sanity if available, `npm run validate`; remote CI proof remains Unknown until push | revert workflow commit |
| GMP-008 | M/L | Add package consumer fixture to validate dist consumption | `tests/package_consumer.test.ts` or `fixtures/consumer/`, package/test config if needed | `npm run build`, consumer import test, `npm pack --dry-run` | revert fixture/test harness commit |
| GMP-009 | S | Add release checklist and metadata finalization notes | `docs/release_checklist.md`, `CHANGELOG.md`, `README.md` | docs review, `npm pack --dry-run` | revert one commit |
| GMP-010 | blocked/S | Finalize license once license choice is supplied | `LICENSE`, `LICENSE_NOTE.md`, `package.json`, `README.md` | `npm pack --dry-run`, package metadata check | revert license metadata commit |

## GMP Sizing Decisions

| Item | v2 Chunk Label | Rationale |
|---|---|---|
| Jest modernization | `single-gmp`, Tier S | one config responsibility; validation is direct |
| npm audit | `single-gmp`, Tier S/M | package/lock only unless dependency chain forces test fixes |
| validate script | `single-gmp`, Tier S | one package metadata change; low blast radius |
| public API boundary | `single-gmp`, Tier S/M | may touch barrel, docs, one test; public-contract risk makes it focused |
| injection safety | `single-gmp`, Tier M/L | can be one coherent subsystem if limited to inject path + docs/tests |
| LLM adapter tests | `single-gmp`, Tier M | isolated adapter; no live network |
| CI workflow | `single-gmp`, Tier S/M | workflow is separate from source behavior; remote proof Unknown until push |
| consumer fixture | `single-gmp` or split | split if fixture requires package harness redesign |
| license | `blocked` until decision | cannot infer legal/business license choice |

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| License choice is Unknown | Treat license GMP as blocked until user supplies MIT/Apache-2.0/proprietary/other choice. Do not invent. |
| Dependency update changes Jest or TypeScript behavior | Run audit fix in its own GMP with full test/typecheck/pack gates. |
| Exporting `compiler.ts` creates accidental public API burden | Decide intent first; if exported, add public API test and docs. If internal, document as internal and keep barrel unchanged. |
| Injection tests reveal ambiguous write semantics | Stop at failing evidence; do not redesign write path unless explicit GMP scope expands. |
| LLM adapter mocking requires a small refactor | Keep refactor isolated to dependency injection/fetch seam only; no live API tests. |
| CI cannot be proven before push | Mark remote CI execution as Unknown; local workflow syntax/checks can be prepared. |
| Package consumer fixture grows too large | Split into fixture-infra GMP and consumer-behavior GMP. |

## Unknowns

| Unknown | Impact | Resolution |
|---|---|---|
| Final license choice | Blocks publish metadata completion | User chooses license; then run GMP-010 |
| `src/compiler.ts` intended public/internal status | Blocks API boundary hardening | Decide before GMP-004; recommended default: internal unless documented public use exists |
| Exact npm audit dependency path | Determines whether update is safe/simple | Run `npm audit --json` inside GMP-002 |
| Whether consumer fixture can stay simple | Affects GMP-008 size | Inspect package exports and test harness before locking GMP-008 |
| Remote GitHub Actions behavior | Cannot be proven local-only | Prepare workflow locally; remote proof only after push |

## Recommended Execution Order

1. **GMP-001:** Modernize Jest config. Low risk, removes warning noise before other test work.
2. **GMP-002:** Resolve/document npm audit. Keeps dependency state honest before CI.
3. **GMP-003:** Add `npm run validate`. Creates one gate for every later GMP.
4. **Decision Gate:** license choice and `compiler.ts` intent.
5. **GMP-004:** Lock public API surface.
6. **GMP-005:** Harden injection safety.
7. **GMP-006:** Add mocked LLM adapter coverage.
8. **GMP-008:** Add package consumer fixture if still justified.
9. **GMP-007:** Add CI workflow using `npm run validate`.
10. **GMP-009:** Release checklist.
11. **GMP-010:** License finalization whenever license decision is available; can move earlier once decided.

## Engineering Ticket Set

### Ticket 1 — Modernize Jest config

**Type:** test  
**GMP Label:** single-gmp  
**Recommended GMP Tier:** S  
**Priority:** P1

**Description**  
Remove the ts-jest deprecation warning without changing test behavior.

**Target Files**

- `jest.config.js` — replace deprecated `globals` ts-jest config with current transform syntax.
- `tests/**` — only if required by failing validation.

**Acceptance Criteria**

1. `npm test` passes with 9 suites / 66 tests or updated count if tests are added later.
2. `npx jest --runInBand` passes.
3. ts-jest deprecation warning is gone.
4. `npm run typecheck` passes.

**GMP Lock Guidance**

- May modify: `jest.config.js`, test config only.
- Must not modify: `src/**` unless validation proves a necessary compatibility fix and scope is revised.
- Rollback: revert one commit.

### Ticket 2 — Resolve dependency audit warning

**Type:** security  
**GMP Label:** single-gmp  
**Recommended GMP Tier:** S/M  
**Priority:** P1

**Description**  
Eliminate or explicitly document the one moderate npm vulnerability.

**Target Files**

- `package.json`
- `package-lock.json`
- `VALIDATION_REPORT.md` or `docs/validation.md` only if risk is accepted instead of fixed.

**Acceptance Criteria**

1. `npm audit --audit-level=moderate` passes, or accepted risk is documented with dependency path and reason.
2. `npm test` passes.
3. `npm run typecheck` passes.
4. `npm pack --dry-run` passes.

### Ticket 3 — Add one-command validation

**Type:** packaging  
**GMP Label:** single-gmp  
**Recommended GMP Tier:** S  
**Priority:** P1

**Description**  
Add a canonical local readiness gate for future GMPs.

**Target Files**

- `package.json` — add `validate` script.
- `README.md` — document local validation command.

**Acceptance Criteria**

1. `npm run validate` runs typecheck, tests, and pack dry-run.
2. Command passes locally.
3. README references the command.

### Ticket 4 — Lock public API surface

**Type:** API contract  
**GMP Label:** single-gmp after decision  
**Recommended GMP Tier:** S/M  
**Priority:** P1

**Description**  
Resolve whether `src/compiler.ts` is internal or public, then encode that decision in tests/docs.

**Target Files**

- `src/index.ts` — only if compiler helpers should be public.
- `tests/public_api.test.ts`
- `README.md`
- `src/compiler.ts` — docs/comments only if needed.

**Acceptance Criteria**

1. `compiler.ts` intent is no longer Unknown.
2. Public API test protects intended exports.
3. README describes the public package surface.
4. `npm run validate` passes.

### Ticket 5 — Harden injection safety guarantees

**Type:** safety/regression  
**GMP Label:** single-gmp or split if semantics are ambiguous  
**Recommended GMP Tier:** M/L  
**Priority:** P1

**Description**  
Make dry-run and output-directory behavior difficult to misuse and regression-proof.

**Target Files**

- `src/inject.ts` if behavior needs tightening.
- `tests/inject*.test.ts`
- `README.md`
- `examples/dry_run.ts` or equivalent.

**Acceptance Criteria**

1. Tests prove `dryRun` does not write to source.
2. Tests prove `outDir` writes do not mutate input files.
3. Destructive writes require explicit non-dry-run behavior.
4. README shows safe first-run usage.
5. `npm run validate` passes.

### Ticket 6 — Mock OpenAI-compatible adapter behavior

**Type:** test/safety  
**GMP Label:** single-gmp  
**Recommended GMP Tier:** M  
**Priority:** P2

**Description**  
Cover network adapter behavior without live credentials or network calls.

**Target Files**

- `src/llm.ts` only if fetch injection seam is required.
- `tests/llm*.test.ts`
- `README.md` if credential behavior needs docs.

**Acceptance Criteria**

1. Tests mock fetch or equivalent transport.
2. Tests cover URL construction, payload shape, response parsing, non-200 errors, and missing credentials.
3. No live API key or network is required.
4. `npm run validate` passes.

### Ticket 7 — Add CI workflow

**Type:** CI  
**GMP Label:** single-gmp  
**Recommended GMP Tier:** S/M  
**Priority:** P2

**Description**  
Prepare GitHub Actions to run the same validation gate used locally.

**Target Files**

- `.github/workflows/ci.yml`
- `README.md` or `docs/release_checklist.md`

**Acceptance Criteria**

1. Workflow installs dependencies and runs `npm run validate`.
2. Workflow does not publish or push.
3. Local validation still passes.
4. Remote CI execution is marked Unknown until pushed.

### Ticket 8 — Add package consumer fixture

**Type:** packaging/regression  
**GMP Label:** single-gmp if simple; split if fixture infra grows  
**Recommended GMP Tier:** M/L  
**Priority:** P2

**Description**  
Verify built `dist` output and declarations are consumable as a package.

**Target Files**

- `tests/package_consumer.test.ts` or `fixtures/consumer/`
- package/test config only if needed.

**Acceptance Criteria**

1. Built package entrypoint imports from `dist` successfully.
2. Type declarations are consumable.
3. Test is deterministic and does not publish.
4. `npm run validate` passes.

### Ticket 9 — Add release checklist

**Type:** release/docs  
**GMP Label:** single-gmp  
**Recommended GMP Tier:** S  
**Priority:** P3

**Description**  
Make future release steps explicit and repeatable.

**Target Files**

- `docs/release_checklist.md`
- `CHANGELOG.md`
- `README.md` only if a short release note link is needed.

**Acceptance Criteria**

1. Checklist covers version bump, build, test, pack dry-run, artifact inspection, publish preflight, and rollback.
2. No publish command is run.
3. `npm pack --dry-run` passes.

### Ticket 10 — Finalize license

**Type:** legal/package metadata  
**GMP Label:** blocked until license choice  
**Recommended GMP Tier:** S  
**Priority:** P0 once license is chosen

**Description**  
Replace license Unknown with explicit package licensing.

**Target Files**

- `LICENSE`
- `LICENSE_NOTE.md`
- `package.json`
- `README.md`

**Acceptance Criteria**

1. User-selected license is recorded exactly.
2. Full license text exists if open-source.
3. `package.json.license` matches.
4. `npm pack --dry-run` includes license artifact.

## Spec Mode Recommendation

Do **not** generate a full architecture spec for the whole repo right now. The reports do not show an architectural redesign need. Use spec mode only for one of these future triggers:

- deciding to expose `compiler.ts` as a formal public subsystem with stable contracts;
- redesigning injection semantics rather than adding tests/docs;
- introducing plugin/provider architecture;
- adding CLI or API behavior beyond current library/toolkit surface;
- changing package lifecycle/release architecture substantially.

If spec mode is triggered, create `specs/{feature}-spec.md` for that subsystem only, then chunk it with the matrix.

## Revised Plan vs v1 Delta

| Area | v1 Output | v2 Revised Skill Output | Delta |
|---|---|---|---|
| Structure | tracks + tasks + suggested tickets | formal plan workflow with source grounding, labels, chunk map, tickets, risks, unknowns | more executable and audit-ready |
| GMP sizing | informal sequence and rough effort | matrix-based S/M/L/XL tiering with split rules and rollback logic | avoids hardcoded tiny chunks while controlling drift |
| Execution handoff | tickets were useful but not GMP-lock shaped | each ticket includes GMP label, tier, target files, acceptance, validation, lock guidance | easier to paste into GMP Phase 0 |
| Unknowns | listed in prose | table with impact and resolution path | better blocker handling |
| Spec usage | recommended only if architecture changes | explicit trigger list for spec mode | prevents unnecessary blueprint bloat |
| API smoke finding | noted out-of-scope | converted into no-op evidence: no API GMP needed | removes fake work |
| Validate script | priority item | moved earlier as enabling gate before CI | better leverage sequencing |
| License | top priority | correctly marked blocked until user decision; can run anytime once decided | more honest execution state |
| Consumer fixture | later item | explicitly sized as M/L with split trigger if infra grows | reduces fixture creep risk |
| Public API | compiler export decision noted | creates a dedicated API contract GMP and ticket | stronger package-boundary control |

## Recommended Next Action

Run GMP-001 first: Jest config modernization.

Why first:

- removes warning noise from every later validation run;
- touches one config file;
- has clear pass/fail gates;
- does not require license/business decision;
- creates an easy local commit and confidence reset.

Then run GMP-002 and GMP-003 before source-behavior changes.

## Completion Criteria

The upgrade campaign is complete when:

- all applicable GMPs have evidence reports;
- license Unknown is resolved or intentionally documented as private/proprietary;
- npm audit warning is fixed or accepted with evidence;
- Jest warning is gone;
- public API surface is intentional and test-backed;
- inject write-path safety is regression-tested;
- LLM adapter has mocked test coverage;
- `npm run validate` passes;
- CI workflow is ready locally, with remote execution marked Unknown until push.


