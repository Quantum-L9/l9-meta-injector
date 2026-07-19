# Remediation Checklist — 07-17-2026

Completion status of the 43 audit findings (see `tasks/queue.json`, `contracts/`, `manifest.json`).

**Legend**
- ✅ **Merged to `main`**
- ⬜ **Not yet addressed**

**Final tally: 43 of 43 findings merged to `main`. Remediation complete.**

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

### Wave 1 — security + supply chain (PR #25)
- [x] **SEC-001** — prototype-key guard on parsed YAML (`Object.create(null)`) — PR #25
- [x] **SEC-002** — glob→RegExp ReDoS / injection hardened in `namespace.ts` — PR #25
- [x] **SEC-003** — refuse cleartext credential when `baseUrl` is `http:` — PR #25
- [x] **SUP-001** — pin exact devDependency versions to the lockfile — PR #25

### Wave 2 — type interface (PR #26)
- [x] **DWL-007** — remove unreachable `intent` field (not in schema vocabulary) — PR #26
- [x] **ICC-004** — narrow `resolveNamespace` port to `NamespaceInput` (`Pick<>`) — PR #26
- [x] **QTE-005** — validated `coerceNormalizedMeta` + `asRecord` replace `as unknown as` casts — PR #26

### Wave 3 — code quality (PR #27)
- [x] **QTE-003** — direct `buildMeta` / `serializeToYamlFrontMatter` unit tests — PR #27
- [x] **QTE-004** — `tests/inject.test.ts` (strategies, dry-run, idempotency, body preservation) — PR #27
- [x] **ICC-005** — shared `MetaRecord` reconcile edge + `normalizeMetaRecord` coercion — PR #27
- [x] **OBS-009** — record true LLM decision path in `FieldDiff.reason` + counter — PR #27
- [x] **OBS-010** — `MetricsCollector` (calls/failures/p50/p95) on LLM/IO hotpaths — PR #27

### Wave 4 — taxonomy + serialization (PR #28)
- [x] **ACA-005** — single canonical YAML serializer (`yaml_serialize.ts`) — PR #28
- [x] **RAA-003** — `ArtifactType` canonical + total typed mappings (`taxonomy.ts`) — PR #28
- [x] **RAA-004** — self-conformance dogfood test over own `src/` — PR #28

### Wave 5 — architecture docs (PR #29)
- [x] **ACA-001** — engine-authority decision: TS authoritative, Python secondary — PR #29
- [x] **ACA-002** — `architecture.md` rewritten to document the shipped TS pipeline — PR #29

---

## Summary

| Status | Findings |
|---|---|
| ✅ Merged to `main` | **43** |
| ⬜ Not yet addressed | **0** |

All 43 audit findings are remediated. The 21 findings from PRs #14–#18 (closed unmerged
during a stacked-branch cascade) were recovered via **PR #22**; the final 17 were
resolved across five stacked waves, **PRs #25–#29**.
