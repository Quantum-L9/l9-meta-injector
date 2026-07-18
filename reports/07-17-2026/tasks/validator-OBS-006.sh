#!/usr/bin/env bash
# Pre-push gate for finding OBS-006 -- synthesized from tasks/queue.json.
# Objective: Record `sidecar_write_failed:${msg}` on unknowns and/or warn; a no-op catch on a write is a swallowed failure.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-OBS-006.yaml"
test -f "reports/07-17-2026/followups/followup-OBS-006.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-OBS-006: green"
