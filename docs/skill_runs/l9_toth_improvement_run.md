<!-- L9_META
l9_schema: 1
artifact_type: skill_run_trace
skill: l9-toth-improvement@1.0.0
parent: l9-toth-improvement
target: Quantum-L9/l9-meta-injector
status: active
tags: [ToTh, skill-run, discovery-metadata, routing, convergence, l9-meta-injector]
/L9_META -->

# ToTh Improvement Run — l9-meta-injector Discovery/Routing Metadata

Skill: `l9-toth-improvement` v1.0.0 · Mode: **Deep** · Date: 2026-07-04
Target scope: entire repo (`Quantum-L9/l9-meta-injector`), branch `claude/unify-l9-meta-injector-r8pufe`, HEAD `7814b06`
Mutation policy: additive discovery metadata only; **no `src/` behavior change** (verified via unchanged selfpack baseline).

## Header

```
Task: Determine and apply the source-grounded, non-stuffing discovery / routing /
      activation metadata enrichment for this repo, and its correct file ownership,
      so downstream agents, registries, tools, skills, and workflows can find,
      route to, and activate the toolkit — with zero drift or contract violation.
Complexity Score: 5 files in candidate scope (+4) + 3 discovery surfaces (+3)
      + 1 open constraint "no-stuff vs max-leverage" (+2) + additive/low-risk (+0) = 9
Tier: Complex → Full block protocol + ADI + ToTh (≥2 branches, recommended 3)
ADI: Full (Abductive + Deductive + Inductive)
Required branches: 3
Convergence target: confidence ≥ 0.90, all 5 criteria PASS
```

## Preflight — 5 First-Order Gates (on the input task)

| Gate | Check | Result |
|------|-------|--------|
| 1 Proof-before-polish | Is there a real, source-grounded need vs. cosmetic? | PASS — discovery fields are thin vs. actual capability surface |
| 2 Effort matches coverage | Scope bounded to discovery surfaces, not a rewrite | PASS |
| 3 Dependency order | Install skill → extract patterns → inject → validate | PASS |
| 4 Reversibility | All changes additive (keywords, new docs, skill install) | PASS |
| 5 No fake validation | Real `build`/`test`/`selfpack` ladder available | PASS |

## Source-Grounded Pattern Extraction (evidence-backed)

Deterministic patterns are read directly from the codebase — not invented.

### Repo-purpose patterns
| Pattern | Evidence (file:line) |
|---|---|
| 6-stage pipeline: classify → extract → assist → inject → verify → index | `README.md:3`, `src/pipeline.ts` |
| Body preserved byte-for-byte; metadata rides in a header/sidecar | `src/inject.ts`, `src/comment.ts` |
| Deterministic id: `<namespace>.<primitive_folder>.<snake_stem>` | `src/namespace.ts:75` |
| Filetype-aware injection (the recent capability leap) | `src/comment.ts:10` |
| Repeatable smoke + baseline drift monitor | `scripts/selfpack.js`, `scripts/selfpack.baseline.json` |

### Reusable primitives (closed taxonomies — canonical routing vocabulary)
| Primitive set | Values | Evidence |
|---|---|---|
| `ArtifactType` | skill, playbook, kernel, context, prompt, doctrine, test, script, source, unknown | `src/schema.ts:4-6` |
| `McpPrimitive` | tool, resource, prompt, none | `src/schema.ts:8` |
| `ArtifactFamily` | auditor, compiler, meta_kernel_forge, builder, planner, research, domain_agent, legal, Unknown | `src/schema.ts:10-12` |
| `SharingScope` | private, shared, agnostic | `src/schema.ts:14` |
| `InjectionStrategy` | yaml-frontmatter, line-comment, block-comment, sidecar, skip-binary | `src/comment.ts:10-15` |
| `ReconcileAction` | add, revise, append-union, keep, replace | `src/reconcile_fields.ts:14` |

### Activation / routing / governance / validation signals
| Signal class | Source-grounded signal | Evidence |
|---|---|---|
| Activation | injects on any text filetype; skips binary/media | `src/comment.ts` (`resolveStrategy`) |
| Routing | classifies artifacts by MCP primitive (tool/resource/prompt) | `src/schema.ts:8`, `src/normalize_meta.ts` |
| Governance | `sharing_scope` invariant: shared primitives must live in shared/core | `src/verify.ts` (`checkSharingScope`) |
| Validation | 5-flag verify: yamlValid, bodyPreserved, taxonomyValid, promptSchemaComplete, sharingScopeValid | `src/verify.ts`, `src/schema.ts:135-143` |
| Discovery output | primitive/prompt library indexes + dedup + verification reports | `src/pipeline.ts:94-98` |

## Branch Specs

### Branch A — Broadcast Injection (PRUNED)
Axis of variation: **Scope / coverage** — run the injector over the whole repo and stamp keywords into every surface (source headers, `package.json`, docs).
Core claim: maximal coverage = maximal discoverability.
Confidence: **0.62**
ADI:
- Abductive: PARTIAL — "more surfaces = more findable" is a weak pattern; discoverability is driven by *canonical* fields, not volume.
- Deductive: **FAIL (hard)** — running the injector now mutates `src/` with output the owner explicitly flagged as *not yet optimal* (idempotency `rerunFilesChanged=5`, `model_target` extraction gap); violates the standing "don't run the all-filetypes phase yet" instruction and the "no drift / no regression" contract rule. Also violates "Do not keyword-stuff."
- Inductive: FAIL — scattered header keywords drift and duplicate the taxonomy already canonical in `src/schema.ts`; unmaintainable.
Decision: **PRUNED** — Deductive hard fail (drift + contravenes explicit user directive).
Absorbed: "discovery vocabulary must be *derived from the tool's own source taxonomy*" → carried into hybrid as the grounding rule for every injected term.

### Branch B — Canonical Discovery Artifact + Curated Keyword Field (SELECTED → WINNER)
Axis of variation: **Ownership** — one source-of-truth discovery artifact; enrich only the existing curated `package.json.keywords`; leave `src/` untouched.
Core claim: discoverability is maximized by a single authoritative, deterministically-derived index plus the canonical registry field — not by volume.
Confidence: **0.88 → 0.92 post-absorption**
ADI:
- Abductive: PASS — mirrors validated discovery patterns (npm keyword index, service registry, sitemap): one canonical, machine-read surface.
- Deductive: PASS — additive only; no contract/invariant touched; `package.json.keywords` is the canonical npm/registry discovery field; `docs/skill_runs/` is the established ownership location for skill-run outputs (`SKILL_RUN_SUMMARY.md`).
- Inductive: PASS — a single deterministically-extracted artifact re-derives on demand; generalizes to any future capability without editing scattered files.
Decision: **SELECTED**.

### Branch C — Inline Distributed L9_META Tags (PRUNED)
Axis of variation: **Data flow / coupling** — add an `L9_META` tag block to the top of every source module.
Core claim: metadata belongs next to the code it describes.
Confidence: **0.66**
ADI:
- Abductive: PARTIAL — inline `L9_META` blocks are a real repo convention (see `docs/**` and the skill references).
- Deductive: PARTIAL — non-breaking comments, but touches ~30 files for a discovery goal (scope drift; violates "touch only task-relevant files").
- Inductive: **FAIL** — per-file tags duplicate `src/schema.ts`'s canonical taxonomy and drift independently; maintenance burden scales with file count.
Decision: **PRUNED** — Inductive fail (duplication/drift) + scope drift.
Absorbed: the **`L9_META` header format** (a good existing convention) → applied to this trace's header instead of scattered across `src/`.

## Hybrid Construction

```
Backbone: Branch B — highest ADI (all PASS), additive, respects file ownership and the
          "no src drift" constraint.

Absorbed from Branch A: "every injected term must be derived from source taxonomy"
  Integration point: keyword-selection rule + pattern-extraction tables above
  Effect: zero invented/vanity terms; each keyword traces to a file:line

Absorbed from Branch C: the L9_META header block format
  Integration point: this document's header
  Effect: consistent with existing repo metadata convention; machine-parseable

Net-new (not in any single branch):
  - This ToTh trace is itself a reusable, source-grounded discovery artifact
    (follows docs/skill_runs/ ownership) — emerged from inductive generalization
  - Selfpack baseline used as the drift proof that src behavior is unchanged
    — emerged during ADI deductive check on "no regression"

Pre-absorption confidence (Branch B): 0.88
Post-absorption confidence (hybrid): 0.92
First-order gate check on hybrid: all 5 PASS
```

## Recursive Improvement Log

```
Pass 1: Keyword set risked stuffing (candidate had dedup/typescript/classify)
        → applied strict "improves routing AND source-grounded AND non-duplicative" test;
          dropped generic/secondary terms → Criterion 3 (no open unknowns) improved
Pass 2: No proof that src behavior is unchanged (no-regression criterion)
        → adopted selfpack baseline equality as the deterministic drift gate
          → Criterion 1 + no_regression PASS
Pass 3: RAFA contingency undefined (high-stakes-change requirement)
        → added RAFA (primary/fallback/trigger) below → Criterion 4 PASS
Pass 4: Block 9 / Block 11 absent
        → added implementation plan + measurable success metrics → Criterion 5 PASS;
          confidence crosses 0.90 → CONVERGED
```

## RAFA Contingency
- **Primary:** additive keyword enrichment + this trace + skill install; validate via ladder.
- **Fallback:** if any keyword is later judged off-target, revert that term in `package.json` (single-line, non-breaking); the trace and skill install stand independently.
- **Trigger:** a downstream consumer reports a keyword as noise, OR `npm run selfpack` drifts (would indicate an unintended `src` change).

## Block 9 — Implementation Plan
- Critical path: install skill → extract patterns (done) → inject curated keywords → validate ladder → commit.
- Files created: `.claude/skills/l9-toth-improvement/**`, `docs/skill_runs/l9_toth_improvement_run.md`.
- Files modified: `package.json` (`keywords` only — additive).
- Files NOT touched: all of `src/`, `dist/`, `tests/`, `schemas/`, `scripts/`, fixtures, baseline.
- Rollback: `git revert` of the commit; each change is additive and independent.
- Testing strategy: `npm run build`, `npm run typecheck`, `npm test`, `node scripts/selfpack.js` (baseline must still match → proves no behavior drift).

## Block 11 — Success Metrics
1. Skill installed and entrypoint parseable → `find .claude/skills` + frontmatter intact.
2. Every injected keyword maps to a source file:line → pattern tables above (verifiable).
3. `npm test` green (92/92) → no regression.
4. `node scripts/selfpack.js` matches baseline → **zero `src` drift**.
5. `package.json` remains valid JSON, `files` allowlist unchanged → no tarball bloat.

## Convergence Declaration

```
CONVERGED at Pass 4.
Confidence: 0.92 (Very High)
All 5 criteria: PASS
Recursive passes run: 4 · Align/improve cycles: 4
Deferred unknowns: none (dial-in items idempotency/model_target/id-stem tracked
  separately in the selfpack baseline; out of scope for this discovery-metadata run)
Decision: Proceed
```
