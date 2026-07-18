#!/usr/bin/env bash
# Pre-push gate for finding RAA-003 -- synthesized from tasks/queue.json.
# Objective: Designate one canonical artifact-type enum and express others as typed mappings onto it, or rename each distinctly (coarse_type vs semantic_class vs inventory_type).
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-RAA-003.yaml"
test -f "reports/07-17-2026/followups/followup-RAA-003.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-RAA-003: green"
