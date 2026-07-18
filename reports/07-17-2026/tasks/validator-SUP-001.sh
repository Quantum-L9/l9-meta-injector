#!/usr/bin/env bash
# Pre-push gate for finding SUP-001 -- synthesized from tasks/queue.json.
# Objective: Pin devDependencies to exact versions, or codify npm ci in CI and document the lockfile as pin authority.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-SUP-001.yaml"
test -f "reports/07-17-2026/followups/followup-SUP-001.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-SUP-001: green"
