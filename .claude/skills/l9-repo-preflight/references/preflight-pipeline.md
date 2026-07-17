<!-- L9_META
l9_schema: 1
parent: l9-repo-preflight
layer: reference
role: preflight_pipeline
tags: [preflight, fail-open, eight-gates, autofix, blockers, ecosystem-neutral]
owner: igor_beylin
status: active
version: 2.0.0
updated: 2026-07-15
/L9_META -->

# The Eight-Gate Preflight Contract (fail-open)

Re-cast from the 10X decision tree into a **fail-open remediation engine**. Every gate is evaluated every run — **nothing halts**. Each gate is `clear` · `autofixable` · `adapt` · `blocker`. The loop applies every safe, reversible autofix, re-probes, and repeats to a fixpoint; what remains is the **genuine-blocker** set.

## The loop

```text
   +---------------------- re-probe ----------------------+
   |                                                      |
Run probe -> evaluate gates -> apply safe autofixes -> fixpoint? --no--+
                                     |                        |
                                (allow-list only)            yes
                                                              |
                                              emit blocker-report + autofix-log
```

Terminates at a fixpoint (no new autofix applies) or `--max-iters`. The run always ends with a report; `ready_after_remediation = (blocker_count == 0)`.

## Verdict vocabulary

`clear` (satisfied) · `autofixable` (a safe reversible fix resolves it) · `adapt` (the blueprint is wrong for this repo — write a new adapted contract) · `blocker` (cannot be safely auto-resolved — reported for downstream).

## The safe + reversible autofix allow-list

`clean_generated` · `git_switch_branch` · `pip_install` · `npm_install` · `editable_install` · `ruff_fix` · `eslint_fix` · `adapt_blueprint`. **Nothing else is ever auto-applied.** Deleting unknown files, reverting user edits, or editing code beyond mechanical format/lint are blockers, not autofixes.

## Ecosystem neutrality

The probe emits `PROBE_ECOSYSTEM` and auto-detects source dirs / packages / foundations. Gates 5–7 and the autofix actions dispatch per ecosystem — **Python** (ruff/mypy/pytest, pip, editable install) and **Node/TypeScript** (eslint/tsc/prettier, npm ci, node_modules). A tool or runtime that is absent is skipped, never a false failure.

---

## Gate 1 — Probe completed
- **clear:** log has all section markers + `PROBE COMPLETE`.
- **blocker:** not a git repo / broken shell env (cannot gather evidence).

## Gate 2 — Correct repository / branch / commit
- **clear:** identity matches the contract, or no contract (accepted as observed).
- **autofix:** wrong branch **and** clean tree **and** contract given → `git switch`.
- **blocker:** wrong repo / wrong commit / wrong-branch-with-dirty-tree (no safe auto-resolution).

## Gate 3 — Worktree clean
- **clear:** no user tracked/staged edits and no unknown untracked files.
- **autofix:** untracked generated artifacts → gitignore + remove; **dependency dirs (`node_modules`) are kept, only ignored.**
- **blocker:** **unknown-provenance files** (offered: quarantine); **user tracked/staged edits** (offered: stash). Files this run created/formatted are tool-owned, not blockers.

## Gate 4 — Required foundations present
- **clear:** every expected foundation resolves.
- **adapt:** a non-core foundation is missing but the repo has an alternate layout → adapt the blueprint (new file).
- **blocker:** a **core** foundation (`pyproject.toml`/`tests`, or `package.json` for node) is missing → wrong/partial checkout.

## Gate 5 — Toolchain matches
- **clear:** the ecosystem runtime is present and the contract's tools are the repo's tools.
- **autofix:** a declared tool is just not installed → `pip install` (python) / `npm ci` (node).
- **adapt:** the contract wants tools the repo does not define → follow the repo (new file).
- **blocker:** no ecosystem runtime available at all.

## Gate 6 — Install succeeded
- **clear:** repo packages import (python) / `node_modules` present (node).
- **autofix:** repo package not importable → editable install; `node_modules` missing → `npm ci`.
- **adapt:** a foreign package the repo does not contain → drop it from the contract.
- **blocker:** the install/build backend itself fails.

## Gate 7 — Baseline reproduces
- **clear:** validators run; any failures are the existing baseline (recorded).
- **autofix:** lint/format failures → `ruff check --fix`+`ruff format` / `eslint --fix`+`prettier --write` (clean tree only).
- **blocker:** **new** (vs the initial baseline) type/test/logic failures — not mechanically fixable.

## Gate 8 — Implementation ready
- Informational. `ready_after_remediation = (genuine blockers == 0)`. The run has already applied every safe fix and reported the rest.

---

## Doctrine (preserved, expressed as reporting not halting)

The old Golden Rules survive as **what gets reported**: never *silently* continue past unknown files, an irreproducible baseline, or unverified identity — they are reported as genuine blockers. Never modify user code or delete unknown files — those are never auto-applied. Adapt the blueprint to evidence, never the repo to the blueprint. The difference from a fail-closed gate: the run does not stop — it fixes what it safely can and hands downstream a precise, machine-readable list of the rest.
