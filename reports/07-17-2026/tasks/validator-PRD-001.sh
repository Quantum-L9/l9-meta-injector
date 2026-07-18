#!/usr/bin/env bash
# Pre-push gate for finding PRD-001 -- synthesized from tasks/queue.json.
# Objective: Implement near-duplicate detection using hashPrefix/threshold and populate nearDuplicates, or remove nearDupThreshold from the config surface and document exact-twin-only.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-PRD-001.yaml"
test -f "reports/07-17-2026/followups/followup-PRD-001.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-PRD-001: green"
