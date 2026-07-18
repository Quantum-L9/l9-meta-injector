#!/usr/bin/env bash
# Pre-push gate for finding RAA-001 -- synthesized from tasks/queue.json.
# Objective: Implement the v3 compile/validate/idempotency path (buildMetaV3 + serializer + presence check), or move v3 types and the contracts.md section to 'planned, not implemented'.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-RAA-001.yaml"
test -f "reports/07-17-2026/followups/followup-RAA-001.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-RAA-001: green"
