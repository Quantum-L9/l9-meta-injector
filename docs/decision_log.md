# Active Decision Log

| # | Decision | Rationale |
|---|---|---|
| 10 | The TypeScript pipeline is the sole active engine | It is the package, tested runtime, and CI-gated implementation. |
| 11 | One active architecture corpus governs the repository | Archived consolidation material cannot compete with current contracts. |
| 12 | Committed `dist/` is retained and must pass source and tarball parity | Consumers execute generated JavaScript and declarations, so both require proof. |
| 13 | Version 3 uses an orchestration-first root plus explicit stable and experimental subpaths | This removes the accidental barrel, preserves intentional low-level access, and makes compatibility testable. |

Historical decisions 1 through 9 remain unchanged under `docs/legacy/consolidation-v1/decision_log.md`.
