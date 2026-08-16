# Publish path for l9-meta-injector.
#
# `make pr` is the only sanctioned route from this repository to GitHub. It exists so a
# push is never separable from the checkers it claims to have passed: the gate runs first,
# and the push and pull request happen only if it is clean.
#
# The Makefile is not part of the packed artifact (`package.json#files` enumerates what
# ships), so nothing here reaches consumers.
#
#   make pr-check   run the canonical gate only, change nothing
#   make pr         gate, then push the current branch and open/reuse its pull request
#
#   PR_BASE=origin/main   base ref for the pull request
#   PR_BODY_FILE=<path>   pull request body; defaults to a commit summary
#   OPEN_PR=0             gate and push, but do not open a pull request

SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
.PHONY: pr pr-check

PR_BASE ?= origin/main
OPEN_PR ?= 1
# Optional: when a governance clone is present, its L4 release receipt is honoured.
GOV_ROOT ?= $(HOME)/.cursor-governance

pr-check:
	@echo "--- canonical gate ---"
	npm run lint
	npm run validate
	@echo "--- committed-state check ---"
	@if [[ -n "$$(git status --porcelain --untracked-files=all)" ]]; then \
	  echo "FAIL: working tree is dirty — a pull request must describe committed state"; \
	  git status --porcelain --untracked-files=all; \
	  exit 1; \
	fi
	@echo "gate: PASS"

pr: pr-check
	@branch="$$(git rev-parse --abbrev-ref HEAD)"; \
	base_ref="$(PR_BASE)"; base_ref="$${base_ref#origin/}"; \
	if [[ "$$branch" == "HEAD" ]]; then echo "FAIL: detached HEAD"; exit 1; fi; \
	if [[ "$$branch" == "main" || "$$branch" == "master" ]]; then \
	  echo "FAIL: on '$$branch' — open a pull request from a feature branch"; exit 1; fi; \
	if ! git rev-parse --verify "$(PR_BASE)" >/dev/null 2>&1; then \
	  echo "FAIL: missing base ref $(PR_BASE)"; exit 1; fi; \
	ahead="$$(git rev-list --count "$(PR_BASE)..HEAD")"; \
	if [[ "$$ahead" -eq 0 ]]; then \
	  echo "FAIL: no commits ahead of $(PR_BASE)"; exit 1; fi; \
	if [[ -f "$(GOV_ROOT)/ops/autonomy/l4_local.py" && "$${L9_L4_LOCAL_AUTONOMY:-1}" != "0" ]]; then \
	  echo "--- L4 local autonomy remote check ---"; \
	  python3 "$(GOV_ROOT)/ops/autonomy/l4_local.py" --workspace "$$(pwd)" check-remote; \
	fi; \
	echo "--- push (branch=$$branch base=$$base_ref; $$ahead commit(s) ahead) ---"; \
	git push -u origin HEAD; \
	if [[ "$(OPEN_PR)" != "1" ]]; then echo "OPEN_PR=0 — pushed, no pull request opened"; exit 0; fi; \
	command -v gh >/dev/null 2>&1 || { echo "FAIL: gh CLI required to open a pull request"; exit 1; }; \
	slug="$$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"; \
	if [[ -z "$$slug" ]]; then \
	  url="$$(git remote get-url origin)"; url="$${url%.git}"; slug="$${url##*github.com/}"; slug="$${slug##*:}"; \
	fi; \
	existing="$$(gh api "repos/$$slug/pulls?head=$${slug%%/*}:$$branch&state=open" -q '.[0].html_url' 2>/dev/null || true)"; \
	if [[ -n "$$existing" && "$$existing" != "null" ]]; then \
	  echo "pull request already open: $$existing"; \
	else \
	  title="$$(git log "$(PR_BASE)..HEAD" --format='%s' --reverse | head -1)"; \
	  body_file="$(PR_BODY_FILE)"; \
	  if [[ -z "$$body_file" ]]; then \
	    body_file="$$(mktemp)"; \
	    { echo "## Commits"; git log "$(PR_BASE)..HEAD" --format='- %s' --reverse; } > "$$body_file"; \
	  fi; \
	  created="$$(gh api -X POST "repos/$$slug/pulls" -f title="$$title" \
	    -f head="$$branch" -f base="$$base_ref" -F body=@"$$body_file" -q '.html_url')"; \
	  echo "opened: $$created"; \
	fi; \
	echo "RESULT: PASS — gate green, branch pushed, pull request open"
