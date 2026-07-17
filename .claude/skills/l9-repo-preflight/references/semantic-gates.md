# Semantic Gates 9–14

## Gate 9: Runtime wiring
Verify declared routes, commands, handlers, and capabilities are reachable from real entrypoints.

## Gate 10: Dormant capability
Detect functions, flags, and configuration that exist but are never activated or referenced.

## Gate 11: Contract drift
Compare OpenAPI routes, Alembic migrations, package entrypoints, and implementation evidence.

## Gate 12: Cross-component alignment
Check lockfiles, dependency consistency, and duplicated shared model definitions.

## Gate 13: Launch aggregation
Deduplicate and severity-rank findings. Only critical blockers prevent the launch-ready verdict. Gate 13 is informational and must not double-count findings.

## Gate 14: CI integrity
Require workflows, verify syntax when actionlint is available, detect fake-green constructs, and identify mutable action references.

All gates fail open operationally: evaluation completes and reports findings. Findings marked `authority_action: blocker` are merged into the top-level genuine blocker set.
