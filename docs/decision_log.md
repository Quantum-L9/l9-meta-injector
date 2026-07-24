# Active Decision Log

The active decision sequence continues after the historical decisions 1 through 9 under `docs/legacy/consolidation-v1/decision_log.md`. Full rationale and alternatives are recorded in `docs/decisions/`.

| # | Decision | ADR | Rationale |
|---|---|---|---|
| 10 | The TypeScript pipeline is the sole active engine | [ADR-010](decisions/010-typescript-pipeline-sole-active-engine.md) | It is the shipped package, tested runtime, and CI-gated implementation. |
| 11 | One active architecture corpus governs the repository | [ADR-011](decisions/011-one-active-architecture-corpus.md) | Archived consolidation material remains traceable without competing with current contracts. |
| 12 | Committed `dist/` is retained and must pass source and tarball parity | [ADR-012](decisions/012-committed-dist-with-parity-proof.md) | Consumers execute generated JavaScript and declarations, so both reviewed source parity and installed-package behavior require proof. |
| 13 | Version 3 uses an orchestration-first root plus explicit stable and experimental subpaths | [ADR-013](decisions/013-orchestration-first-public-api.md) | This prevents an accidental root barrel while preserving deliberate lower-level access. |
| 14 | CI uses a canonical aggregate gate plus independent lint, type, test, analysis, and supply-chain contexts | [ADR-014](decisions/014-layered-ci-gates.md) | Integrated package proof and fast failure isolation are both required. |
| 15 | npm publication remains fail-closed until external evidence and owner approval are recorded | [ADR-015](decisions/015-fail-closed-publication.md) | Technical readiness does not itself authorize external distribution. |
