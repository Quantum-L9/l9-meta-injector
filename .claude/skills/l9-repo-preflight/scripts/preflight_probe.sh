#!/usr/bin/env bash
# 10X Repository Preflight Probe — read-only evidence gatherer.
#
# Writes NOTHING but a timestamped log. Feeds the eight preflight gates
# (see references/probe-contract.md for the section -> gate map).
#
# Repo-specific tokens are AUTO-DETECTED from the checkout (no repo's names are
# baked in) and are env-overridable. They are a HYPOTHESIS the evaluator's verified
# evidence overrides (Golden Rule 4: adapt the blueprint to evidence, not the reverse).
#
#   PROBE_PACKAGES     importable Python packages to check (default: auto — empty on non-Python repos)
#   PROBE_KEY_PATHS    key source dirs to inventory + scan  (default: auto — the ones that exist)
#   PROBE_FOUNDATIONS  foundations Gate 4 expects           (default: auto — the language markers present)
#
# Example (override for a specific repo):
#   PROBE_PACKAGES="my_pkg" PROBE_FOUNDATIONS="pyproject.toml src tests" \
#     bash scripts/preflight_probe.sh

set -u

# --------------------- repo-shape auto-detection (neutral) -------------------
# Never assume a language. Detect what is actually present so a TS/Node, Go, Rust,
# or Python repo each gets sensible defaults — nothing from the skill's own repo.
_detect_key_paths() {
  local out="" d
  for d in src lib app cmd pkg internal packages apps services .github/scripts tests test schemas; do
    [ -d "$d" ] && out="$out $d"
  done
  printf "%s" "${out# }"
}
_detect_packages() {
  # Python packages only (dirs with __init__.py). Empty on non-Python repos, so a
  # TS/Node repo is never probed for a Python import that cannot exist.
  find . -maxdepth 4 -name __init__.py \
    -not -path '*/node_modules/*' -not -path './.git/*' -not -path '*/.venv/*' 2>/dev/null \
    | sed 's#/__init__.py$##; s#.*/##' | sort -u | head -5 | tr '\n' ' ' | sed 's/ $//'
}
_detect_foundations() {
  local out="" f d
  for f in pyproject.toml setup.py package.json go.mod Cargo.toml pom.xml build.gradle; do
    [ -f "$f" ] && out="$out $f"
  done
  for d in tests test; do [ -d "$d" ] && out="$out $d"; done
  printf "%s" "${out# }"
}
_detect_ecosystem() {
  # Which language ecosystems are present (may be several in a polyglot repo).
  local out=""
  [ -f package.json ] && out="$out node"
  { [ -f pyproject.toml ] || [ -f setup.py ] || [ -f setup.cfg ]; } && out="$out python"
  [ -f go.mod ] && out="$out go"
  [ -f Cargo.toml ] && out="$out rust"
  printf "%s" "${out# }"
}

# ----------------------------- config block ---------------------------------
PROBE_KEY_PATHS="${PROBE_KEY_PATHS:-$(_detect_key_paths)}"
PROBE_PACKAGES="${PROBE_PACKAGES:-$(_detect_packages)}"
PROBE_FOUNDATIONS="${PROBE_FOUNDATIONS:-$(_detect_foundations)}"
PROBE_ECOSYSTEM="${PROBE_ECOSYSTEM:-$(_detect_ecosystem)}"
# ----------------------------------------------------------------------------

section() {
  printf "\n===== %s =====\n" "$1"
}

safe() {
  "$@" 2>&1 || printf "[command failed: %s]\n" "$*"
}

LOG="repo-preflight-$(date -u +%Y%m%dT%H%M%SZ).log"

{

section "TIMESTAMP"
date -u +"UTC=%Y-%m-%dT%H:%M:%SZ"
printf "HOST=%s\n" "$(hostname 2>/dev/null || echo UNKNOWN)"
printf "USER=%s\n" "$(id -un 2>/dev/null || echo UNKNOWN)"
printf "PWD=%s\n" "$PWD"
printf "PROBE_PACKAGES=%s\n" "$PROBE_PACKAGES"
printf "PROBE_FOUNDATIONS=%s\n" "$PROBE_FOUNDATIONS"
printf "PROBE_ECOSYSTEM=%s\n" "$PROBE_ECOSYSTEM"

section "REPOSITORY IDENTITY"
safe git rev-parse --is-inside-work-tree
printf "ROOT=%s\n" "$(git rev-parse --show-toplevel 2>/dev/null || echo UNKNOWN)"
printf "GIT_DIR=%s\n" "$(git rev-parse --git-dir 2>/dev/null || echo UNKNOWN)"
printf "BRANCH=%s\n" "$(git branch --show-current 2>/dev/null || echo DETACHED_OR_UNKNOWN)"
printf "HEAD=%s\n" "$(git rev-parse HEAD 2>/dev/null || echo UNKNOWN)"
printf "HEAD_SHORT=%s\n" "$(git rev-parse --short=12 HEAD 2>/dev/null || echo UNKNOWN)"
printf "HEAD_SUBJECT=%s\n" "$(git log -1 --pretty=%s 2>/dev/null || echo UNKNOWN)"
printf "HEAD_AUTHOR=%s\n" "$(git log -1 --pretty="%an <%ae>" 2>/dev/null || echo UNKNOWN)"
printf "HEAD_DATE=%s\n" "$(git log -1 --pretty=%aI 2>/dev/null || echo UNKNOWN)"

section "REMOTES"
safe git remote -v

section "TRACKING AND DIVERGENCE"
printf "UPSTREAM=%s\n" "$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo NONE)"
safe git status --branch --short
safe git branch -vv
if git rev-parse --verify @{u} >/dev/null 2>&1; then
  printf "AHEAD_BEHIND="
  safe git rev-list --left-right --count HEAD...@{u}
fi

section "WORKTREE STATUS"
safe git status --short --untracked-files=all
printf "TRACKED_MODIFIED_COUNT=%s\n" "$(git status --porcelain=v1 | grep -Ec "^[ MARC][MD]" || true)"
printf "UNTRACKED_COUNT=%s\n" "$(git status --porcelain=v1 | grep -Ec "^\?\?" || true)"
printf "STAGED_COUNT=%s\n" "$(git diff --cached --name-only | sed "/^$/d" | wc -l | tr -d " ")"
printf "UNSTAGED_COUNT=%s\n" "$(git diff --name-only | sed "/^$/d" | wc -l | tr -d " ")"

section "DIFF SUMMARY"
safe git diff --stat
safe git diff --cached --stat
printf "\nTracked changed files:\n"
safe git diff --name-status
printf "\nStaged changed files:\n"
safe git diff --cached --name-status
printf "\nUntracked non-ignored files:\n"
safe git ls-files --others --exclude-standard

section "IGNORE DIAGNOSTICS"
for p in .venv .pytest_cache .mypy_cache .ruff_cache __pycache__ build dist "*.egg-info"; do
  printf "%-20s : " "$p"
  git check-ignore -v "$p" 2>/dev/null || echo "not ignored or absent"
done

section "TOP-LEVEL INVENTORY"
safe find . -maxdepth 2 \
  -not -path "./.git*" \
  -not -path "./.venv*" \
  -not -path "./node_modules*" \
  -printf "%y %p\n" | sort | head -500

section "KEY FILE PRESENCE"
for p in \
  pyproject.toml setup.py setup.cfg requirements.txt requirements-dev.txt \
  uv.lock poetry.lock pdm.lock Pipfile Pipfile.lock \
  package.json package-lock.json pnpm-lock.yaml yarn.lock bun.lockb \
  tsconfig.json .eslintrc .eslintrc.json .eslintrc.js .eslintrc.cjs eslint.config.js \
  .prettierrc .prettierrc.json prettier.config.js jest.config.js vitest.config.ts node_modules \
  go.mod Cargo.toml \
  AGENTS.md README.md LICENSE LICENSE.md Makefile \
  tox.ini noxfile.py pytest.ini mypy.ini ruff.toml \
  .pre-commit-config.yaml Dockerfile docker-compose.yml compose.yaml \
  .github/workflows \
  $PROBE_KEY_PATHS $PROBE_FOUNDATIONS
do
  if [ -e "$p" ]; then
    printf "present  %s\n" "$p"
  else
    printf "missing  %s\n" "$p"
  fi
done

section "PYTHON TOOLCHAIN"
for py in python python3 python3.11 python3.12; do
  if command -v "$py" >/dev/null 2>&1; then
    printf "%s_PATH=%s\n" "$py" "$(command -v "$py")"
    "$py" --version 2>&1
  fi
done
printf "VIRTUAL_ENV=%s\n" "${VIRTUAL_ENV:-NONE}"
printf "PIP_PATH=%s\n" "$(command -v pip 2>/dev/null || echo NONE)"
safe python -m pip --version
safe python -m pip list --format=freeze

section "PROJECT METADATA"
if [ -f pyproject.toml ]; then
  safe python -c "
import pathlib, json
try:
    import tomllib
except ModuleNotFoundError:
    tomllib = None
p = pathlib.Path('pyproject.toml')
if tomllib is None:
    print('tomllib unavailable (python < 3.11); skipping structured parse')
else:
    d = tomllib.loads(p.read_text())
    out = {
      'build_system': d.get('build-system'),
      'project': d.get('project'),
      'tool_keys': sorted(d.get('tool', {}).keys()),
    }
    print(json.dumps(out, indent=2, default=str))
"
fi

section "PACKAGE DISCOVERY"
for root in $PROBE_KEY_PATHS; do
  [ -d "$root" ] || continue
  safe find "$root" -maxdepth 4 -type f \
    \( -name "*.py" -o -name "py.typed" \) \
    -not -path "*/__pycache__/*" | sort
done
safe python -c "
import importlib.util
for name in '$PROBE_PACKAGES'.split():
    spec = importlib.util.find_spec(name)
    print(f\"{name}={spec.origin if spec else 'NOT_IMPORTABLE'}\")
"

section "TEST INVENTORY"
safe find tests -maxdepth 4 -type f | sort
printf "PYTEST_TEST_COUNT_ESTIMATE="
grep -R --include="test_*.py" --include="*_test.py" -hE "^[[:space:]]*(async[[:space:]]+)?def[[:space:]]+test_" tests 2>/dev/null | wc -l | tr -d " "

section "VALIDATION TOOL AVAILABILITY"
for tool in pytest ruff mypy pyright black isort pre-commit tox nox coverage build twine \
            node npm pnpm yarn npx eslint tsc prettier jest vitest biome; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf "%-12s %s\n" "$tool" "$(command -v "$tool")"
  else
    printf "%-12s MISSING\n" "$tool"
  fi
done

section "MAKE TARGETS"
if [ -f Makefile ]; then
  grep -E "^[A-Za-z0-9_.-]+:([^=]|$)" Makefile | sed "s/:.*//" | sort -u
fi

section "PYPROJECT COMMAND CONFIG"
if [ -f pyproject.toml ]; then
  grep -nE "^\[(project|project\.scripts|project\.optional-dependencies|tool\.(pytest|ruff|mypy|setuptools|coverage|hatch|poetry|pdm|uv))" pyproject.toml || true
fi

section "CI WORKFLOWS"
if [ -d .github/workflows ]; then
  for f in .github/workflows/*; do
    [ -f "$f" ] || continue
    printf "\n--- %s ---\n" "$f"
    grep -nE "^(name:|on:|[[:space:]]+runs-on:|[[:space:]]+python-version:|[[:space:]]+run:|[[:space:]]+uses:)" "$f" || true
  done
fi

section "GIT HOOKS AND ATTRIBUTES"
safe git config --get core.hooksPath
[ -f .gitattributes ] && safe cat .gitattributes
[ -f .gitignore ] && safe cat .gitignore

section "LARGE AND SUSPICIOUS FILES"
safe find . \
  -not -path "./.git/*" \
  -not -path "./.venv/*" \
  -type f -size +5M \
  -printf "%s %p\n" | sort -nr | head -50

section "COMMON GENERATED ARTIFACTS"
safe find . -maxdepth 5 \
  \( -name ".venv" -o -name ".pytest_cache" -o -name ".mypy_cache" \
     -o -name ".ruff_cache" -o -name "__pycache__" -o -name "*.egg-info" \
     -o -name "*.dist-info" -o -name ".coverage" -o -name "htmlcov" \
     -o -name "build" -o -name "dist" \) \
  -print | sort

section "SUBMODULES AND LFS"
safe git submodule status
safe git lfs ls-files

section "RECENT HISTORY"
safe git log --oneline --decorate -10

section "FINAL CLEANLINESS"
safe git status --short --untracked-files=all
printf "FINAL_HEAD=%s\n" "$(git rev-parse HEAD 2>/dev/null || echo UNKNOWN)"

section "PROBE COMPLETE"

} 2>&1 | tee "$LOG"
