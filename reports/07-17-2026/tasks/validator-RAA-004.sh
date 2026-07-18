#!/usr/bin/env bash
# Pre-push gate for finding RAA-004 -- synthesized from tasks/queue.json.
# Objective: Run the injector over its own src/ as a CI step (or commit stamped headers), turning self-injection into a behavior test.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-RAA-004.yaml"
test -f "reports/07-17-2026/followups/followup-RAA-004.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-RAA-004: green"
