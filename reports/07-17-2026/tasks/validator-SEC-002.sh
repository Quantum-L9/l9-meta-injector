#!/usr/bin/env bash
# Pre-push gate for finding SEC-002 -- synthesized from tasks/queue.json.
# Objective: Escape all regex metacharacters in literal glob segments before substituting wildcard tokens (reuse comment.ts esc()), and/or wrap new RegExp in try/catch treating malformed glob as non-matching.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-SEC-002.yaml"
test -f "reports/07-17-2026/followups/followup-SEC-002.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-SEC-002: green"
