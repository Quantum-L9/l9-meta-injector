#!/usr/bin/env bash
# Pre-push gate for finding SEC-003 -- synthesized from tasks/queue.json.
# Objective: Reject non-https: baseUrl (or require explicit allow-insecure opt-in) before sending the Authorization header; optionally allowlist hosts.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-SEC-003.yaml"
test -f "reports/07-17-2026/followups/followup-SEC-003.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-SEC-003: green"
