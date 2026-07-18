#!/usr/bin/env bash
# Pre-push gate for finding ACA-002 -- synthesized from tasks/queue.json.
# Objective: Add/replace architecture.md to document the TS pipeline (retrieval→extract→classify→normalize_meta→inject→verify→compiler) as primary; scope the Python tool as secondary.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-ACA-002.yaml"
test -f "reports/07-17-2026/followups/followup-ACA-002.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-ACA-002: green"
