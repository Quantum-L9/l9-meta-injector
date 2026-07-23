# Active Decision Log

| # | Decision | Rationale | Status |
|---|---|---|---|
| 10 | The TypeScript pipeline is the sole authoritative engine; `tools/consolidation/` is reference-only | The npm package, tests, selfpack, CI, source contracts, and generated output all target the TypeScript implementation. One authority prevents dialect and workflow drift. | active |
| 11 | Maintain one active architecture corpus and archive superseded consolidation material | Active-looking historical contracts caused agents and maintainers to follow a coherent but non-authoritative system. Archived material remains available without governing new work. | active |
| 12 | Retain committed `dist/` and require deterministic source-to-package proof | `check:dist` compares committed output to an isolated TypeScript build, while `test:packed` validates and installs the exact tarball. This preserves the established package model without allowing silent generated-mirror drift. | active |
| 13 | Make the package root orchestration-first and version additional supported entrypoints explicitly | The current barrel exposes broad low-level capabilities. RAA-007 will define stability tiers and an explicit export map before narrowing the surface. | pending RAA-007 implementation |

## Historical decisions

Decisions 1 through 9 governed the superseded consolidation architecture and are preserved at `docs/legacy/consolidation-v1/decision_log.md`.
