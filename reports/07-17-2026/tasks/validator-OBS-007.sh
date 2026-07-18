#!/usr/bin/env bash
# Pre-push gate for finding OBS-007 -- synthesized from tasks/queue.json.
# Objective: On readdir catch, emit a diagnostic and record skipped dir (synthetic record or top-level skippedDirs list).
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-OBS-007.yaml"
test -f "reports/07-17-2026/followups/followup-OBS-007.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-OBS-007: green"
