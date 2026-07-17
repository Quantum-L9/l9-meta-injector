# Regression Guard

- Preserve the legacy `hybrid_semantic_index` engine identifier.
- Build the semantic snapshot once per run and reuse it downstream.
- Keep source bytes authoritative; derived facts and graph edges are projections.
- Keep observed facts separate from inferred resolution edges.
- Never force one target for ambiguous or dynamic relationships.
- Bound negative claims by the coverage ledger.
- Preserve Gates 1-20, MCP-first routing, Gate 20 static fallback, kernel runtime, and manifest validation.
- Require all 124 tests to remain green before release.

## V4.2 reasoning guards

- Every surfaced finding is eligible for Gate 20 synthesis.
- Gate 20A synthesis findings are citable by Gate 20B.
- A validated response must produce a completion receipt with a response digest.
- Interactive defaults request host-agent reasoning; autonomous runs remain static without external credentials.
- Reasoning may not clear deterministic blockers or `not_observed` states.
