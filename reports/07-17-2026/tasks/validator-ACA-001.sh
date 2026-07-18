#!/usr/bin/env bash
# Pre-push gate for finding ACA-001 -- synthesized from tasks/queue.json.
# Objective: Declare one engine authoritative (the shipped TS package) and reduce the other to calling it or explicitly out-of-scope; or define one shared header-dialect contract both read/write/strip.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-ACA-001.yaml"
test -f "reports/07-17-2026/followups/followup-ACA-001.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-ACA-001: green"
