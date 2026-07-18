#!/usr/bin/env bash
# Pre-push gate for finding PRD-002 -- synthesized from tasks/queue.json.
# Objective: Capture the write failure into the record/unknowns (push sidecar_write_failed:<path>:<err>) and surface a non-silent status; don't treat an unwritable target as success.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-PRD-002.yaml"
test -f "reports/07-17-2026/followups/followup-PRD-002.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-PRD-002: green"
