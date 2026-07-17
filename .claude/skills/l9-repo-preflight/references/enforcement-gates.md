<!-- L9_META
l9_schema: 1
parent: l9-repo-preflight
layer: reference
role: enforcement_gates
tags: [preflight, fail-open, enforcement, audit, autofix, blockers]
owner: igor_beylin
status: active
version: 2.0.0
updated: 2026-07-15
/L9_META -->

# Enforcement Gates (completeness + audit, not halting)

The engine is fail-open, so enforcement is not "stop on a violation" — it is **prove the run was complete, every autofix was safe and logged, and every genuine blocker is actionable.** A run that skips a gate, applies an unsafe fix, or emits a bare blocker is non-compliant.

## The gate artifacts

| Gate | Step | Required artifact | Non-compliant when |
|------|------|-------------------|--------------------|
| A | Run probe | a probe log ending in `PROBE COMPLETE`, all sections present | log truncated / missing sections |
| B | Extract expertise (exemplary builds) | `expertise_model.yaml` + `skill_intelligence_report.yaml`, cap-valid | intelligence model missing/incomplete |
| C | Evaluate gates | a report with a verdict per gate 1–8 + autofix plans + genuine blockers | any gate `Unknown` with no evidence |
| D | Apply autofixes | an `autofix-log.json` entry per action: gate, command, result, `reversible:true` | an action off the allow-list, or not reversible |
| E | Re-probe | a **new** probe log post-dating the last fix | a gate re-evaluated from a stale log |
| F | Fixpoint | the loop stopped because no new autofix applied (or `--max-iters`) | the loop ran without converging or a cap |
| G | Emit report | `blocker-report.json` with `run_completed:true`; each blocker has class, severity, evidence, why-not-autofixable, remediation | a blocker missing evidence or remediation |

## Protocol-violation detection

A run is **non-compliant** — report it — if any of these hold:

1. **Unsafe autofix.** An applied action is not on the allow-list, or mutated an unknown file, tracked code (beyond mechanical format/lint), or a validation baseline. The allow-list is absolute.
2. **Dependency dir deleted.** `node_modules` (or another dependency dir) was removed instead of ignored.
3. **Bare blocker.** A genuine blocker was emitted without evidence or without a remediation (owner + steps).
4. **False blocker.** A condition on the autofix allow-list was reported as a blocker instead of being fixed.
5. **Stale-gate evaluation.** A verdict cites a probe log older than the most recent remediation.
6. **Blueprint-forced failure.** Gate 4/5/6 emitted `blocker` solely because the repo lacks a blueprint assumption that is not actually required here — it must be `adapt`.
7. **Halt.** The run stopped before emitting a report. The engine is fail-open; `run_completed` must be true.

## Verdict + severity vocabulary

Gates resolve to `clear` / `autofixable` / `adapt` / `blocker`. Genuine blockers are severity-ranked `critical` > `high` > `medium`, each with `why_not_autofixable` and a `remediation` (owner ∈ {human, downstream-agent}, steps, commands, optional reversible `auto_option`). `ready_after_remediation` is the whole-run verdict: true iff `blocker_count == 0`.

## The loop is the enforcement

Every fix re-enters through a fresh probe (Gate E's artifact is a log newer than the fix), and evaluation may only cite the newest log. Fail-open does not mean unbounded: Gate F requires a fixpoint or the iteration cap, and Gate D requires every action to be reversible and logged. Aggressive autofix is safe precisely because the allow-list and the audit log are enforced here.
