#!/usr/bin/env bash
# Pre-push gate for finding QTE-004 -- synthesized from tasks/queue.json.
# Objective: Add tests/inject.test.ts covering each strategy, dryRun (no mutation, diff written), re-run idempotency, and body-preservation (postInjectionBodyHash===originalBodyHash).
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-QTE-004.yaml"
test -f "reports/07-17-2026/followups/followup-QTE-004.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-QTE-004: green"
