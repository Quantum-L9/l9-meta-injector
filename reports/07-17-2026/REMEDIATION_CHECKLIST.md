# Remediation Checklist — 07-17-2026

Completion status of the 43 audit findings (see `tasks/queue.json`, `contracts/`, `manifest.json`).

**Legend**
- ✅ **Merged to `main`**
- ⬜ **Not yet addressed**

**Final tally: 26 of 43 findings merged to `main`; 17 not yet addressed.**

---

## ✅ Merged to `main`

### Release blockers
- [x] **ACA-003 / PRD-001** — `nearDupThreshold` fail-open no-op → real near-dup detection (shingle-Jaccard) — PR #13
- [x] **OBS-002** — pipeline `verify()` result consumed (`VerificationSummary`, gate flag) — PR #13

### Dead-wiring / latent capability (recovered via PR #22)
- [x] **DWL-001** — wire in 17-class semantic classifier — PR #14 → #22
- [x] **DWL-002** — wire in placement-policy compiler — PR #14 → #22
- [x] **DWL-003 / RAA-001** — MetaV3 nine-plane builder (`meta_v3.ts`) — PR #14 → #22
- [x] **DWL-004** — remove dead `isMateriallyBetter` + orphan `materialityCheck` — PR #18 → #22
- [x] **DWL-005** — surface `namespaceGlobs` on `PipelineConfig` — PR #18 → #22
- [x] **DWL-006** — remove never-read `promptGlob` — PR #18 → #22
- [x] **DWL-008** — export `comment`/`compiler` primitives from index — PR #18 → #22

### Observability (recovered via PR #22)
- [x] **OBS-001** — structured LLM call diagnostics — PR #15 → #22
- [x] **OBS-003** — pipeline coverage tally — PR #15 → #22
- [x] **OBS-004** — record swallowed `injectFile` error — PR #17 → #22
- [x] **OBS-005** — distinguish read error from binary — PR #17 → #22
- [x] **OBS-006 / PRD-002** — record sidecar write failures — PR #17 → #22
- [x] **OBS-007** — record unreadable-directory skips (`skippedDirs`) — PR #17 → #22
- [x] **OBS-008** — surface excluded unreadable file — PR #17 → #22

### Contract single-sourcing (recovered via PR #22)
- [x] **ACA-004 / ICC-001** — single-source `FieldDiff` — PR #16 → #22
- [x] **RAA-002 / ICC-002** — single-source `SharingScope` — PR #16 → #22
- [x] **ICC-003** — single-source LLM materiality prompt (`materiality.ts`) — PR #16 → #22

### Quality / tests
- [x] **QTE-001** — `compiler.ts` test coverage — PR #13
- [x] **QTE-002** — tautological LLM-adapter test → real fetch-mock behavior tests — PR #9

### Supporting work
- [x] **(follow-up) verify body-hash bug** — `stripExistingFrontMatter` blank-line round-trip fix — PR #12
- [x] **(hardening)** — `ci.yml` SHA-pinned actions + timeout + least-priv permissions — PR #9
- [x] **(consolidation)** — `inject.ts` → `parseCanonicalYaml`; canonical `isPromptMeta` — PR #9
- [x] **(test)** — `verify.test.ts` regression + `ruff` formatting of `tools/consolidation` — PR #10
- [x] **CI** — removed redundant `pr-pipeline.yml` (#19); added Scorecard + SBOM gates (#20); autonomous-mode config (#23)

## ⬜ Not yet addressed
- [ ] **ACA-001** — parallel TS/Python injection engines (deferred — needs authoritative-engine decision)
- [ ] **ACA-002** — `architecture.md` documents Python, not the shipped TS pipeline
- [ ] **ACA-005** — two hand-rolled YAML serializers/parsers (partially eased by PR #9)
- [ ] **RAA-003** — four competing `artifact_type` vocabularies
- [ ] **RAA-004** — engine does not dogfood its own metadata (self-conformance)
- [ ] **QTE-003** — `normalize_meta` tested only transitively
- [ ] **QTE-004** — `inject.ts` lacks dedicated unit tests
- [ ] **QTE-005** — `as unknown as` double-casts at the meta boundary
- [ ] **ICC-004** — over-wide `NamespaceConfig` port
- [ ] **ICC-005** — typed→untyped reconcile edge
- [ ] **OBS-009** — LLM degraded-mode not signalled
- [ ] **OBS-010** — no metrics on LLM/IO hot paths
- [ ] **DWL-007** — unreachable `intent` field branch
- [ ] **SEC-001** — prototype-key guard on parsed YAML
- [ ] **SEC-002** — glob→RegExp ReDoS / injection in `namespace.ts`
- [ ] **SEC-003** — cleartext credential when `baseUrl` is `http:`
- [ ] **SUP-001** — floating devDependency ranges

---

## Summary

| Status | Findings |
|---|---|
| ✅ Merged to `main` | **26** |
| ⬜ Not yet addressed | **17** |

The 21 findings from PRs #14–#18 (closed unmerged during a stacked-branch cascade) were recovered and merged via **PR #22**.
