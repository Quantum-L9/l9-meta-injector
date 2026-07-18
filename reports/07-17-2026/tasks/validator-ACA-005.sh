#!/usr/bin/env bash
# Pre-push gate for finding ACA-005 -- synthesized from tasks/queue.json.
# Objective: Consolidate on one YAML serializer and one parser shared by normalize_meta, inventory, inject, and meta_schema.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-ACA-005.yaml"
test -f "reports/07-17-2026/followups/followup-ACA-005.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-ACA-005: green"
