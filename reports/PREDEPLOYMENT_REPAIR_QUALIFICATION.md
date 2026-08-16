# Pre-deployment repair qualification — l9-meta-injector

Requalification of the producer against real repositories and the actual
`l9-constellation-topology` consumer, after repairing the defects the earlier
real-repository E2E qualification exposed.

> **Amendment (conflict resolution against a moved `main`).** This report was written
> against base `051bc9c`. Before it could merge, `main` landed its own interpretation seam
> (ADR-032, `032-deterministic-repository-interpretation-seam.md`, PR #59). Rather than ship
> a second interpretation engine — which `CLAUDE.md` forbids — this branch's
> `src/repository_interpretation.ts`, its tests and fixtures, and its ADR-032 were removed
> during the merge, and `main`'s interpretation was kept. `main`'s pass is the broader of
> the two: it additionally extracts README status and replacement, the `AGENTS.md` canonical
> contract declarations, and the packet-envelope invariants, none of which this branch's
> three extractors covered.
>
> **Every F-T1 measurement below therefore describes an implementation that is no longer
> part of this branch, and is retained only as a record of what was measured at the time.**
> Every other finding in this report — F-1 through F-7, ADR-034 and ADR-035 — is unaffected
> and still carried here.

- **Repository:** `Quantum-L9/l9-meta-injector`
- **Bound base revision:** `051bc9c675d713d1a3316e86e4ee8ba5f7ec4ab1` (`main`)
- **Branch:** `claude/l9-meta-injector-repair-ysbw8h`
- **Date:** 2026-08-16
- **Toolchain:** Node v22.22.2, Python 3.11.15 (consumer probe only), Linux

Every specimen below was bound to an exact revision at the start of the run. No specimen
source was modified: `Quantum-L9/L9-Ops-MCP` was adopted on a disposable clone, and
`cryptoxdog/golden-repo` was observed read-only.

---

## Findings disposition

| Finding | Class | Disposition |
|---|---|---|
| F-1 | CLI parser defect | **Closed.** Boolean flags consume no following argv element; `--no-<flag>` is the explicit false form; a value option is never satisfied by a known option token. |
| F-2 | Output contract mismatch | **Closed.** `docs/output-placement-contract.md` is the single source of truth; the two defaults are documented as intentional and bound by `tests/output_placement_contract.test.ts` and `invocation_boundary.output_placement`. |
| F-3 | Legacy policy not implemented | **Closed.** `legacy_writers` is passed into the one authority scanner and decides disposition (ADR-034). |
| F-4 | Legacy false positive | **Closed.** A write is an L9-metadata write only when tied to the L9 metadata surface. Historical marker text is inert evidence under both policies. |
| F-5 | Failure observability | **Closed.** `scripts/lib/operation-report.js` renders code, path, message and evidence in a deterministic order, with credential-shaped values redacted. |
| F-6 | Frontmatter adoption blocker | **Closed.** Unsupported frontmatter routes to the central manifest with a diagnostic and the run continues; opaque single-line scalars are preserved verbatim (ADR-035). |
| F-7 | Platform portability | **Closed on the evidence available.** See *macOS* below. |
| F-I1 | Conformance evidence drift | **Closed.** Evidence regenerated through `npm run topology:conformance -- --update` against the exact tested consumer revision. |
| F-T1 | Producer semantic coverage | **Closed.** Separate deterministic interpretation stage (ADR-032). |

One additional in-scope defect was found and repaired during F-6 work: `verify` recovered a
frontmatter body with `stripExistingFrontMatter` while `inject` captured it with
`inspectFrontMatterDocument`. Any file that *already* carried frontmatter followed by a
blank line therefore failed the `APPLY_VERIFICATION_FAILED` body-preservation postcondition
and aborted governed apply. Reproduced on the bound base revision before repair.

---

## Specimen 1 — `Quantum-L9/L9-Ops-MCP` (adoption and mutation safety)

- **Bound revision:** `bb5f88fffb18f9461375183309734be4b5d7e7b5`
- **Mutation:** disposable clone only; the read-only checkout was never written to
- **Authority setup:** `.l9/meta-authority.yaml` with `legacy_writers: migration_only`,
  `default_carrier: central_manifest`, `inline_allow: [prompts/**/*.md, playbooks/**/*.md, docs/**/*.md]`

### Flow

| Step | Result |
|---|---|
| `apply` | exit **0** — scanned 324, planned 324, changed 93, inlineChanged 92, one transaction, 93/93 committed |
| `check` | exit **0** — scanned 324, drift **0**, authorityConflicts **0** |
| re-apply | exit **0** — changed **0**, plannedWrites **0** |
| repository-model emit | packet `packet:9d28593a31e452c9122422297bc5653f980595e71a5edf0e242aee8713646a87` |
| topology consumer acceptance | **passed**, no translation shim |

### Gates

| Gate | Required | Observed |
|---|---|---|
| apply exit | 0 | 0 |
| authority conflicts from historical markers | 0 | **0** (34 markers reported as `META_LEGACY_METADATA_PRESENT` notices) |
| manual legacy-marker strips | 0 | **0** |
| manual `--omit` patterns for F-6 | 0 | **0** |
| drift after apply | 0 | 0 |
| second apply changed / planned writes | 0 | 0 / 0 |
| second apply byte-identical tree | yes | yes (`git write-tree` identical: `b6a5c828abedda2acb1bf3f344b442c81a61a40c`) |
| unrelated mutations | 0 | **0** — every write landed in `docs/**`, `playbooks/**` (the declared `inline_allow` scope) plus `.l9/metadata-index.jsonl` |
| `SKILL.md` files mutated | 0 | **0** |
| original test suite regression | 0 | **0** — `18 passed, 4 skipped` before and after, identical |

### Frontmatter fallback

Two files carried frontmatter outside the inline-patchable subset. Both were reported and
both are byte-identical to the untouched baseline:

```
apply-cli: note: playbooks/microservice-build/PLAYBOOK.md: existing frontmatter is outside the
  inline-patchable subset (FRONTMATTER_COMPLEX_YAML); source bytes are preserved
  [frontmatter_unsupported:FRONTMATTER_COMPLEX_YAML]
apply-cli: note: skills/meta/optimize-kernel/SKILL__source_ecaa3134.md: … (same)
```

On the bound base revision, either of these aborted the entire repository apply.

---

## Specimen 2 — `cryptoxdog/golden-repo` (structured semantic precision)

- **Bound revision:** `0b9f9202c80fc066e8c23dc1d783b99a2789160b`
- **Mutation:** none. Verified: working tree and HEAD unchanged after observation.

### Required observations

| Required | Observed |
|---|---|
| package identity from `pyproject.toml` | `l9-service` (`pyproject.toml`, declared, authority `source`) |
| Python runtime constraint | `python ^3.11` |
| FastAPI dependency | `fastapi` |
| Uvicorn dependency | `uvicorn` |
| Poetry packaging | `poetry` (from `[tool.poetry]` + `build-backend = "poetry.core.masonry.api"`) |
| service spec identity | `golden-repo-ai-review-system` (`spec.yaml`) |
| `execute` action | capability `execute` |
| `describe` action | capability `describe` |
| `GET /health` route | entrypoint `GET /health` |
| `POST /v1/execute` route | entrypoint `POST /v1/execute` |
| TODO marker for the execute handler | `engine/main.py:37`, scoped to handler `execute`, route `POST /v1/execute` |

Consumer acceptance: **passed**, no translation shim. 261 artifacts, 2 capabilities,
276 relationships (`CONTAINS`, `DOCUMENTED_BY`, `ROUTES_TO`), 319 evidence, 38 diagnostics.

### Precision gate

| Gate | Required | Observed |
|---|---|---|
| unsupported high-confidence claims | 0 | **0** — every high-confidence interpretation fact is `evidence_class: declared` with `authority: source`. The remaining 115 high-confidence observed records are inventory `artifact_type` classifications, each with a content hash. |
| identity conflations | 0 | **0** — package identity (`l9-service`), service identity (`golden-repo-ai-review-system`) and repository name (`golden-repo`) are three distinct values in three distinct fields. |

Forbidden claims: absent. `primary_role` stays `unknown`; `upstream_repository_ids` is
empty; capabilities carry empty `implemented_by` / `exposed_by` / `validated_by`; route
evidence is capped at `level: medium`, `completeness: partial`. The words "reachable" and
"deployed" appear once each, inside the diagnostic that explicitly *disclaims* them.

---

## Determinism matrix

Measured on specimen 2 unless noted.

| Case | Requirement | Observed |
|---|---|---|
| exact replay | same packet id, semantic hash, bundle bytes | same / same / same |
| checkout path change | same packet id and semantic hash | same / same (bundle bytes identical too) |
| `generated_at` change | semantic hash unchanged | unchanged; `packet_id` unchanged; packet bytes differ, as they must |
| interpretation profile change | semantic hash changes | changes (`tests/repository_interpretation.test.ts`) |
| relevant repository semantic change | semantic hash changes | changes — renaming spec action `describe` → `explain` moved the hash and the capability set |

No hash was frozen to make a test pass. Both committed golden bundles were regenerated
from source, and the topology conformance evidence was regenerated from the real probe.

---

## Native validation

`npm ci`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run check:api`,
`npm run check:authority`, `npm run check:manifest`, `npm run check:dist`,
`npm run selfpack`, `npm run test:packed`, `npm run check:release-candidate`,
`npm run validate` — **all pass**. 639 tests across 68 files.
`git status --porcelain --untracked-files=all` is empty after the final commit.

No generated artifact was hand-edited. `dist/`, the architecture manifest, the selfpack
baseline, both golden bundles and the conformance evidence were regenerated through their
canonical tooling.

---

## Topology conformance

- **Consumer:** `Quantum-L9/l9-constellation-topology`
- **Exact revision tested:** `06ad4d9d30114ec6b26d8644dbab821b98fddaaf`
- **Entrypoints:** `packets.loader.load_repository_model_bundle`,
  `packets.adapters.repository_model_v1.RepositoryModelV1Adapter.adapt`
- **Result:** passed for both committed bundles and for both live specimen packets;
  `translation_shim_required: false`

`docs/topology-conformance.json` records `06ad4d9d…` — the revision that was actually
probed. The previously recorded `bb374e09…` was stale (F-I1).

---

## Known limitations

- **macOS `npm run validate` was not executed.** No macOS runner was available in this
  environment. The single macOS-specific divergence — `normalizeEnvironment` resolving
  `RUNNER_TEMP` through `fs.realpathSync` while the assertion compared the raw
  `os.tmpdir()` spelling — is fixed, and is now reproduced deterministically on every
  platform by a symlinked-`RUNNER_TEMP` test in `tests/action_boundary.test.ts`. That test
  fails against the pre-repair assertion. Linux CI equivalence is green.
- Interpretation covers three extractors. Other manifests (`go.mod`, `Gemfile`, `pom.xml`),
  other web frameworks, and document-level semantics are not interpreted. Their absence is
  silence, not a claim.
- `package_identity`, `runtime_constraint`, `service_identity` and `implementation_marker`
  have no dedicated field in `l9.repository-model` 1.0.0. They are preserved as evidence
  plus a `contract-field-unavailable` diagnostic. Extending the wire schema was out of
  scope for a repository-only repair.
- Capabilities carry no `implemented_by` / `exposed_by` / `validated_by`. Establishing
  those needs implementation-side evidence this producer does not yet gather.
- The `--fail-on-issues=false` dispatcher input is still not consumed by `apply-cli.js`.
  It predates this contract and was left untouched.

---

## Authorization

This qualification does **not** authorize merge, deployment, Gate dispatch, memory
mutation, release, or world-model work.
