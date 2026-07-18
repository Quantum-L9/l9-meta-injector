#!/usr/bin/env bash
# Pre-push gate for finding ACA-003 -- synthesized from tasks/queue.json.
# Objective: Implement prefix/threshold near-duplicate clustering using the computed hashPrefix, or remove nearDupThreshold/hashPrefixLength from public config and report unsupported (fail-closed).
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-ACA-003.yaml"
test -f "reports/07-17-2026/followups/followup-ACA-003.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-ACA-003: green"
