# Repository Intelligence Plane

## Authority boundary

Repository source bytes remain authoritative. The intelligence plane emits deterministic, versioned evidence projections and never replaces source identity, source registry, policy, or gate ownership.

## Processing position

1. Acquire repository and detect environment/trust boundaries.
2. Build the semantic snapshot once.
3. Build deterministic module-resolution edges.
4. Route capabilities from structural evidence.
5. Run gates, domain projections, and Gate 20 synthesis.

## Canonical artifacts

- `semantic-snapshot.json`: facts, stable IDs, snapshot lineage, parser provenance.
- `semantic-coverage.json`: eligible, parsed, failed, unsupported, and excluded files.
- `semantic-resolution-graph.json`: resolved, candidate, dynamic, unresolved, or contradictory edges.
- `semantic-delta.json`: snapshot changes when a parent snapshot is supplied.
- `semantic-evidence.jsonl`: append/query-friendly fact stream.

## Epistemic layers

Observed facts and resolved relationships are separate. A parser can prove that a call exists while target resolution remains unresolved. Every fact records syntax and resolution authority independently.

## Query contract

Query results include the repository snapshot ID, facts, coverage, limitations, authority floor, and whether the requested scope was completely observed. Zero results are not treated as proof of absence when coverage is incomplete.

## Current graph boundary

V4.1 implements deterministic local module resolution. It does not claim a universal call graph. Dynamic dispatch, dependency injection, reflection, generated code, compiler-resolved types, and interprocedural data flow remain explicit future layers.
