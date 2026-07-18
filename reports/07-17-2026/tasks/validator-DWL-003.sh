#!/usr/bin/env bash
# Pre-push gate for finding DWL-003 -- synthesized from tasks/queue.json.
# Objective: Add a NormalizedMeta→MetaV3 builder wired into inject/index emission (≥1 live producer+consumer), or drop the v3 types until a consumer exists.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-DWL-003.yaml"
test -f "reports/07-17-2026/followups/followup-DWL-003.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-DWL-003: green"
