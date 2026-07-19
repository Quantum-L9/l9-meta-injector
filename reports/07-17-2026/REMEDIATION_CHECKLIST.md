# Remediation Checklist — 07-17-2026

Completion status of the 43 audit findings (see `tasks/queue.json`, `contracts/`).

**Legend**
- ✅ **Merged to `main`**
- 🟡 **Open PR** (remediated, verified green, awaiting merge)
- ⛔ **Remediated but PR closed unmerged** — code is NOT on `main`; branch still exists, recoverable by reopening / re-PRing
- ⬜ **Not yet addressed**

---

## Release blockers
- [x] ✅ **ACA-003** — `nearDupThreshold` fail-open no-op → real near-dup detection (shingle-Jaccard) — **PR #13 (merged)**
- [x] ✅ **OBS-002** — pipeline `verify()` result now consumed (`VerificationSummary`, gate flag) — **PR #13 (merged)**

## Merged to `main` ✅
- [x] **ACA-003 / PRD-001** — near-dup no-op fixed — PR #13
- [x] **OBS-002** — verify signal consumed — PR #13
- [x] **QTE-001** — `compiler.ts` test coverage added — PR #13
- [x] **(follow-up) verify body-hash bug** — `stripExistingFrontMatter` blank-line round-trip fix (`bodyPreserved` false-positive) — PR #12
- [x] **CI** — removed redundant `pr-pipeline.yml` — PR #19
- [x] **CI** — added `l9-ci-core` supply-chain gates (OpenSSF Scorecard + SBOM) — PR #20

## Open PRs (remediated, awaiting merge) 🟡
- [ ] 🟡 **QTE-002** — tautological LLM-adapter test → real fetch-mock behavior tests — **PR #9**
- [ ] 🟡 **(hardening)** — `ci.yml` SHA-pinned actions + `timeout` + least-priv `permissions` — **PR #9**
- [ ] 🟡 **(consolidation)** — `inject.ts` hand-rolled parser → `parseCanonicalYaml`; canonical `isPromptMeta` — **PR #9**
- [ ] 🟡 **(test)** — `verify.test.ts` body-preservation regression + `ruff` formatting of `tools/consolidation` — **PR #10**

## Remediated but PR CLOSED / NOT on `main` ⛔
> Fixes were implemented, tested green, and pushed, but the PRs were closed without merging (stacked-branch cascade when #13 merged). Branches still exist — recoverable.

- [ ] ⛔ **DWL-001** — wire in 17-class semantic classifier — PR #14 (closed)
- [ ] ⛔ **DWL-002** — wire in placement-policy compiler — PR #14 (closed)
- [ ] ⛔ **DWL-003 / RAA-001** — MetaV3 nine-plane builder (`meta_v3.ts`) — PR #14 (closed)
- [ ] ⛔ **OBS-001** — structured LLM call diagnostics — PR #15 (closed)
- [ ] ⛔ **OBS-003** — pipeline coverage tally — PR #15 (closed)
- [ ] ⛔ **ACA-004 / ICC-001** — single-source `FieldDiff` — PR #16 (closed)
- [ ] ⛔ **RAA-002 / ICC-002** — single-source `SharingScope` — PR #16 (closed)
- [ ] ⛔ **ICC-003** — single-source LLM materiality prompt (`materiality.ts`) — PR #16 (closed)
- [ ] ⛔ **OBS-004** — record swallowed `injectFile` error — PR #17 (closed)
- [ ] ⛔ **OBS-005** — distinguish read error from binary — PR #17 (closed)
- [ ] ⛔ **OBS-006 / PRD-002** — record sidecar write failures — PR #17 (closed)
- [ ] ⛔ **OBS-007** — record unreadable-directory skips (`skippedDirs`) — PR #17 (closed)
- [ ] ⛔ **OBS-008** — surface excluded unreadable file — PR #17 (closed)
- [ ] ⛔ **DWL-004** — remove dead `isMateriallyBetter` + orphan `materialityCheck` — PR #18 (closed)
- [ ] ⛔ **DWL-005** — surface `namespaceGlobs` on `PipelineConfig` — PR #18 (closed)
- [ ] ⛔ **DWL-006** — remove never-read `promptGlob` — PR #18 (closed)
- [ ] ⛔ **DWL-008** — export `comment`/`compiler` primitives from index — PR #18 (closed)

## Not yet addressed ⬜
- [ ] ⬜ **ACA-001** — parallel TS/Python injection engines (deferred — needs authoritative-engine decision)
- [ ] ⬜ **ACA-002** — `architecture.md` documents Python, not the shipped TS pipeline
- [ ] ⬜ **ACA-005** — two hand-rolled YAML serializers/parsers (partially eased by PR #9)
- [ ] ⬜ **RAA-003** — four competing `artifact_type` vocabularies
- [ ] ⬜ **RAA-004** — engine does not dogfood its own metadata (self-conformance)
- [ ] ⬜ **QTE-003** — `normalize_meta` tested only transitively
- [ ] ⬜ **QTE-004** — `inject.ts` lacks dedicated unit tests
- [ ] ⬜ **QTE-005** — `as unknown as` double-casts at the meta boundary
- [ ] ⬜ **ICC-004** — over-wide `NamespaceConfig` port
- [ ] ⬜ **ICC-005** — typed→untyped reconcile edge
- [ ] ⬜ **OBS-009** — LLM degraded-mode not signalled
- [ ] ⬜ **OBS-010** — no metrics on LLM/IO hot paths
- [ ] ⬜ **DWL-007** — unreachable `intent` field branch
- [ ] ⬜ **SEC-001** — prototype-key guard on parsed YAML
- [ ] ⬜ **SEC-002** — glob→RegExp ReDoS / injection in `namespace.ts`
- [ ] ⬜ **SEC-003** — cleartext credential when `baseUrl` is `http:`
- [ ] ⬜ **SUP-001** — floating devDependency ranges

---

## Summary

| Status | Count |
|---|---|
| ✅ Merged to main | 4 findings (ACA-003, PRD-001, OBS-002, QTE-001) + 2 CI PRs + 1 follow-up |
| 🟡 Open PR (awaiting merge) | QTE-002 (#9) + hardening (#9, #10) |
| ⛔ Remediated, PR closed, NOT on main | 21 findings (PRs #14–#18) |
| ⬜ Not yet addressed | 17 findings |

**Action needed:** the ⛔ items (PRs #14–#18) were fully implemented and green but never landed on `main`. Reopen those PRs or re-open them against current `main` to recover ~21 findings of remediation.
