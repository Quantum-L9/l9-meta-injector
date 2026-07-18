#!/usr/bin/env bash
# Pre-push gate for finding QTE-003 -- synthesized from tasks/queue.json.
# Objective: Add unit tests for buildMeta per artifact_type asserting emitted field set + taxonomy, plus serializeToYamlFrontMatter scalar quoting/escaping and empty-array handling.
# Fail-closed: any non-zero step blocks the push/PR step in Agent B.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. Contract + followup for this finding must exist (bundle integrity).
test -f "reports/07-17-2026/contracts/task-QTE-003.yaml"
test -f "reports/07-17-2026/followups/followup-QTE-003.json"

# 2. Project must build and pass its own suite before we open a PR.
if [ ! -d node_modules ]; then
  npm ci
fi
npm run typecheck
npm test

echo "validator-QTE-003: green"
