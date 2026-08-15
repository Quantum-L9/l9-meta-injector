# L9 Audit Suite — Tool Improvement Plan

**Subject:** Closing the gaps between what the audit tool *prescribed* and what the
remediation *actually did*, by fixing the tool so its workflow becomes self-enforcing.
**Tool version:** l9-audit-suite v0.6.0 → proposed **v0.7.0**
**Target repo audited:** `Quantum-L9/l9-meta-injector` @ `3fba77d` (remediated through `main` @ `a1dfdab`)
**Scope of this plan:** fix the **tool itself** — not re-running the repo-side verification.

---

## 1. Context

This engagement executed the **front half** of the L9 Audit Suite's prescribed workflow
cleanly:

> run 10 audits → 43 findings → leverage-gated Flawless-Victory task contracts →
> remediate all 43 in CI-gated stacked PRs (#25–#30).

But the remediation **diverged from the tool's own closed-loop workflow**, and in every
case the divergence was possible *only because the tool's enforcement mechanism was
missing or unimplemented*. In other words: the gaps are not primarily remediation
mistakes — they are **holes in the tool** that let a diligent operator skip verification
and breach scope fences without anything noticing.

Fixing the tool (rather than patching this one run) is the durable fix: the next audit
cycle then cannot silently skip verification or breach a fence.

---

## 2. Gap analysis — prescribed vs. actual vs. root cause

| # | Tool prescribes | What actually happened | Tool gap that allowed it |
|---|---|---|---|
| G1 | Mark a finding complete **only** when audit 05 reports `verified_status: resolved` (via `one_command_chain.py --verify-report`) | "43/43 resolved" was asserted by PR-merge; audit 05 was never run (`L9_AUDIT_SUITE_REPORT.md`: *"Audit 05 … was not run"*) | `--verify-report` is documented (`README.md:52`) and fixture-backed (`examples/verify-AUD-004-resolved.json`) but **not implemented** in the shipped `one_command_chain.py`. The only completion path is the unsafe `--complete`, which marks done with no check. |
| G2 | `scope_fence.allowed_paths` bounds each fix; `stop_if[0]` aborts "editing paths outside allowed_paths" | Fixes extracted new shared modules (`taxonomy.ts`, `yaml_serialize.ts`, `metrics.ts`) that were **not** in the contract's `allowed_paths` — technically breaching the fence, undetected | `allowed_paths` is regex-harvested from the finding's `evidence` with `PATH_RE = [\w./\-]+\.\w+(?::\d+)?`, which matches code symbols (`cfg.namespace`, `JSON.stringify`) as if they were paths and drops the `src/` prefix. And **no checker enforces the fence** — `stop_if` is honor-system. |
| G3 | `followups/*.json` are per-finding verification records | All 43 stubs left as `target_repo` / `new_base_ref` = `"UNKNOWN"`, with no status recorded | `followup_stub()` emits a template with **no `verified_status` field, no evidence slot** — and nothing ever fills it. |
| G4 | Single source of truth per concept (the tool's own doctrine, audits 07/09) | — | The emit / path-derivation / fence logic is **copy-pasted** across `audit_to_contract.py` and `tools/one_command_chain.py`, and the copies have **already drifted**: `followup_verify.audit` is `"07-recursive-alignment.md"` in one and `"05-followup-remediation-audit.md"` in the other; one emits `leverage_score`, the other doesn't. The tool violates the very rule it audits for. |
| G5 | `run_audits.py --with-verify` runs audit 05 (stage 4) after remediation and feeds completion | The re-audit loop was never closed | There is **no bridge** from audit-05 output → `--verify-report` → state completion; audit 05's machine-readable output shape is undefined. |

**Not a gap (verified):** `leverage_score` is fully reproducible — the weights live in
`finding_schema.py::LeveragePreflight.score()` and reproduce the reported values exactly
(e.g. ACA-001 preflight `{3,4,3,2,2}` → `3.0`). Leave it untouched.

**Over-delivery, not a gap:** the tool's leverage gate deferred 29 low-leverage findings
(`leverage_gate`, threshold 2.5); the remediation resolved **all 43** anyway. More
thorough than prescribed — no action needed.

---

## 3. Fixes

Each fix closes one gap above.

### Fix 1 — Implement `--verify-report` (the closed-loop completion gate)
*File:* `tools/one_command_chain.py`

Add `--verify-report <path>` that:
- accepts the single-object fixture shape (`{finding_to_verify, verified_status}`) **or an
  array** of such records (audit-05 output);
- marks a finding `completed` **only** when `verified_status == "resolved"`;
- records `partially-resolved | unresolved | regressed | UNKNOWN` (with evidence) without
  completing the finding;
- stamps `verified_at` + `verified_base_ref` into run state.

Demote the blind `--complete` behind an explicit `--force-unverified` flag (or keep it but
emit a loud "UNVERIFIED override" warning and tag it in history), so the evidence-backed
path is the default.

### Fix 2 — Real, enforceable scope fences
*Files:* shared lib (see Fix 4), consumed by `audit_to_contract.py` + `one_command_chain.py`

- **Tighten path derivation:** keep a token only if it is path-shaped (contains `/` **or**
  ends in a known source extension) and reconcile it with `owner_layer`; drop code-symbol
  tokens like `cfg.namespace` / `JSON.stringify`.
- **Allow the legitimate "extract a shared module" pattern:** express the fence as
  directory-glob allowances derived from `owner_layer` (e.g. `src/**`) plus the specific
  evidence files — so adding a new file *within an owner-layer directory* is in-fence, while
  edits to unrelated trees still breach.
- **Add a fence checker** `check_diff_against_fence(allowed_globs, changed_files) -> breaches`,
  exposed as a function and a CLI (`--check-fence <task.yaml> --changed a.ts,b.ts`), invoked
  automatically in the `--execute` post-run and inside `--verify-report`. This makes
  `stop_if[0]` real instead of honor-system.

### Fix 3 — Followup records that can actually be filled
*Files:* `tools/one_command_chain.py` (`followup_stub`), `finding_schema.py`

Extend the record with `verified_status` (default `"UNKNOWN"`), `evidence` (list),
`verified_at`, `verified_base_ref`, `fence_breaches`. Add a `FollowupRecord` / `VerifyRecord`
model to `finding_schema.py` so both the stub and `--verify-report` validate one shape.
`--verify-report` writes the completed record back over the stub.

### Fix 4 — Single-source the duplicated emit / fence / path logic (dogfood the doctrine)
*New file:* `l9_audit_suite/contract_lib.py`

Hold the canonical `PATH_RE` + derivation, `emit_task_block`, `followup_stub`,
`to_yaml_scalar`, and the fence checker. Import from both `audit_to_contract.py` and
`tools/one_command_chain.py`, deleting the local copies. Resolves the existing drift; pick
`05-followup-remediation-audit.md` as the single correct audit reference.

### Fix 5 — Bridge `run_audits.py --with-verify` → `--verify-report`
*Files:* `audits/05-followup-remediation-audit.md`, `tools/run_audits.py`

Add a **"## Output contract"** section to audit 05 defining its machine-consumable output
as a verify-report JSON array (`[{finding_to_verify, verified_status, evidence}]`), and have
`run_audits.py --with-verify` write that array to a known path — so it pipes straight into
`one_command_chain.py --verify-report`. This is the missing link that would have let this
run's remediation be machine-confirmed.

### Fix 6 — Docs + version
*Files:* `README.md`, `CHANGELOG.md`, `pyproject.toml`

Align docs with the now-real `--verify-report`; document the `--complete` demotion and the
fence checker; bump to **0.7.0**; note the additive schema change (`FollowupRecord`).

---

## 4. Files touched

| Action | Path | Purpose |
|---|---|---|
| **New** | `l9_audit_suite/contract_lib.py` | Shared emit / path-derivation / fence logic (Fix 2, 4) |
| **New** | `tests/` (pytest) | Cover verify-report gating, fence checker, path derivation, emit parity |
| Edit | `tools/one_command_chain.py` | `--verify-report`, `--force-unverified`, fence wiring, import shared lib (Fix 1, 2, 3) |
| Edit | `audit_to_contract.py` | Import shared lib; delete local copies (Fix 4) |
| Edit | `finding_schema.py` | `FollowupRecord` / `VerifyRecord` model (Fix 3) |
| Edit | `tools/run_audits.py` | Emit verify-report array under `--with-verify` (Fix 5) |
| Edit | `audits/05-followup-remediation-audit.md` | Output contract (Fix 5) |
| Edit | `README.md`, `CHANGELOG.md`, `pyproject.toml` | Docs + version (Fix 6) |
| **Reuse (do not touch)** | `finding_schema.py::leverage_gate` / `LeveragePreflight.score` | Already correct/reproducible |
| **Reuse** | `examples/verify-AUD-004-resolved.json` | Becomes the canonical `--verify-report` input shape |

---

## 5. Verification (end-to-end)

1. **Unit (pytest):**
   - `--verify-report` completes on `resolved`, refuses on `unresolved` / `UNKNOWN`; `--complete`
     alone no longer completes without `--force-unverified`.
   - Fence checker: a changed file inside an owner-layer dir passes; an out-of-tree file is a breach.
   - Path derivation: `cfg.namespace` / `JSON.stringify` dropped; real `src/*.ts` paths kept.
   - Emit parity: `audit_to_contract` and `one_command_chain` produce byte-identical task blocks
     for the same finding (kills the drift).
2. **Regression on the real 43:** run the patched `audit_to_contract.py` over
   `reports/07-17-2026/L9_AUDIT_SUITE_FINDINGS.json`; diff regenerated fences vs. the shipped
   `contracts/`. Expect symbol-free, path-only `allowed_paths`, and confirm the
   QTE-005 / ACA-005 / RAA-003 fences now legitimately permit the new-module extractions that
   previously breached them.
3. **Loop dry-run:** feed a hand-made verify-report
   (`[{finding_to_verify:"SEC-001", verified_status:"resolved", evidence:["tests/security.test.ts"]}]`)
   into `--verify-report`; confirm SEC-001 is completed with evidence while an `unresolved` entry
   stays open.
4. **Package:** rebuild the tarball, `pip install` / import-smoke, re-run pytest from the packaged copy.

---

## 6. Delivery

The tool is not a git repo in session scope (extracted from the uploaded tarball). Two options:
- **(a)** Patch the extracted tool + add pytest → deliver a re-packaged
  `l9auditsuite0.7.0consolidated.tar.gz`. No git repo touched.
- **(b)** Add a `Quantum-L9/l9-audit-suite` repo to the session → push the fixes as a PR, using
  the same autonomous, CI-gated workflow as the remediation.

**Out of scope (per decision):** running audit 05 against the remediated `l9-meta-injector`,
re-running the 10 audits for regression, and editing the `reports/07-17-2026/` artifacts. Those
are repo-side actions; this plan hardens the *tool* so that loop becomes enforceable next time.
