<!-- L9_META
l9_schema: 1
parent: l9-repo-preflight
layer: reference
role: probe_contract
tags: [preflight, probe, evidence, section-to-gate, parameterizable]
owner: igor_beylin
status: active
version: 1.0.0
updated: 2026-07-15
/L9_META -->

# Probe Contract (evidence → gate mapping)

The probe ([scripts/preflight_probe.sh](../scripts/preflight_probe.sh)) is **read-only**: it writes nothing but a timestamped log. It emits labeled sections (`===== NAME =====`); the evaluator ([scripts/evaluate_preflight.py](../scripts/evaluate_preflight.py)) parses those sections and feeds them to the gates. This file is the map.

## Section → gate

| Probe section | Feeds gate | Used for |
|---|---|---|
| `TIMESTAMP` | 1 | run identity; freshness (must post-date the last fix) |
| `REPOSITORY IDENTITY` | 2 | root, git-dir, branch, HEAD, subject/author/date |
| `REMOTES` | 2 | origin URL vs expected repo |
| `TRACKING AND DIVERGENCE` | 2 | upstream, ahead/behind |
| `WORKTREE STATUS` | 3 | `TRACKED_MODIFIED_COUNT`, `UNTRACKED_COUNT`, `STAGED_COUNT`, `UNSTAGED_COUNT` |
| `DIFF SUMMARY` | 3 | tracked/staged/untracked file lists for classification |
| `IGNORE DIAGNOSTICS` | 3 | which generated artifacts are ignored vs tracked |
| `TOP-LEVEL INVENTORY` | 3, 4 | what actually exists at the tree top |
| `KEY FILE PRESENCE` | 4 | foundations present/missing (`present`/`missing` lines) |
| `PYTHON TOOLCHAIN` | 5 | interpreter paths + versions, venv, pip |
| `PROJECT METADATA` | 4, 5 | `pyproject.toml` build-system / project / tool keys |
| `PACKAGE DISCOVERY` | 5, 6 | source files + importability (`NAME=… / NOT_IMPORTABLE`) |
| `TEST INVENTORY` | 7 | test files + estimated test count |
| `VALIDATION TOOL AVAILABILITY` | 5, 7 | pytest/ruff/mypy/… present or `MISSING` |
| `MAKE TARGETS` / `PYPROJECT COMMAND CONFIG` | 5, 6 | declared commands / install + validation entry points |
| `CI WORKFLOWS` | 5, 7 | what CI runs (the authoritative validation contract) |
| `GIT HOOKS AND ATTRIBUTES` | 3 | `.gitignore` / `.gitattributes` / hooks path |
| `LARGE AND SUSPICIOUS FILES` | 3 | oversized / unexpected artifacts |
| `COMMON GENERATED ARTIFACTS` | 3 | generated dirs present (classification input) |
| `SUBMODULES AND LFS` | 2, 4 | submodule / LFS state |
| `RECENT HISTORY` | 2 | last commits (identity corroboration) |
| `FINAL CLEANLINESS` | 3 | end-of-probe status + `FINAL_HEAD` |
| `PROBE COMPLETE` | 1 | completion marker (its absence fails Gate 1) |

## The auto-detected, ecosystem-neutral surface

The probe **auto-detects repo shape** — no language or package name is baked in. Each token defaults to what the checkout actually contains, and is env-overridable. They are a **hypothesis**; verified evidence overrides them (adapt, not fail).

| Token | Meaning | Default (auto-detected) |
|---|---|---|
| `PROBE_ECOSYSTEM` | language ecosystems present | `node` / `python` / `go` / `rust` from marker files |
| `PROBE_PACKAGES` | importable **Python** packages to check | dirs with `__init__.py` — **empty on non-Python repos** |
| `PROBE_KEY_PATHS` | source dirs to inventory + scan | the subset of `src lib app cmd pkg packages apps .github/scripts tests schemas` that exist |
| `PROBE_FOUNDATIONS` | foundations Gate 4 expects | the language markers present (`package.json` / `pyproject.toml` / `go.mod` / … + `tests`) |

Override per repo via environment variables, e.g.:

```bash
PROBE_PACKAGES="my_pkg" PROBE_FOUNDATIONS="pyproject.toml src tests" \
  bash scripts/preflight_probe.sh
```

### Why auto-detected, not hardcoded

The source probe was authored against a Python `src/`-layout repo and hardcoded that repo's package names. On a **TS/Node repo** those tokens are simply wrong — probing for a Python package that cannot exist. Auto-detection removes every baked-in name: a Node repo yields `PROBE_ECOSYSTEM=node`, **empty** `PROBE_PACKAGES` (no Python import attempted), and `package.json` foundations; a Python repo yields its real packages and `pyproject.toml`. Gates 5–7 and the autofix actions then dispatch per ecosystem (ruff/mypy/pytest + pip for Python; eslint/tsc/prettier + npm for Node). A foreign expectation the repo does not meet is `adapt`, never a false failure.

## Work products live under `.preflight/`

`remediate.py` writes probe logs, the `blocker-report.json`, and the `autofix-log.json` under `.preflight/`, which it adds to `.git/info/exclude` (local, no tracked-file mutation) so the tool never pollutes the worktree it measures. The probe's own `repo-preflight-*.log` is classified as a generated artifact, never an unknown file.

## The expected contract (optional, for Gate 2/4/5)

Provide `--expected <contract>` to `evaluate_preflight.py` to turn Gate 2 `confirm` into a decidable `pass`/`blocked` and to give Gates 4/5 an explicit foundations/toolchain target. Schema: [schemas/expected-contract.schema.json](../schemas/expected-contract.schema.json). The contract is authority level 3 — **below verified evidence** (level 2): where they disagree, evidence wins and the gate returns `adapt`.
