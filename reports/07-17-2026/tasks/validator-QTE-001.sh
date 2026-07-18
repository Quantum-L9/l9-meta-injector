#!/usr/bin/env bash
# Pre-push gate for finding QTE-001 -- synthesized from tasks/queue.json.
# Objective: Add tests/compiler.test.ts asserting exact-twin grouping, uniqueCount arithmetic, isPromptMeta filtering, injectable filtering, and dedupReportToMarkdown shape.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-QTE-001.yaml"
test -f "reports/07-17-2026/followups/followup-QTE-001.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-QTE-001: green"
