# Active Contracts

## Pipeline

`src/pipeline.ts#runPipelineAsync` is the stable orchestration contract. It accepts `PipelineConfig` and returns `PipelineResult`, including verification, coverage, placement plans, MetaV3 records, and metrics. Optional `localFiles` (ADR-016) materializes `.zip` archives beside themselves before scan, for disposable local trees that the operator intends to modify; default mode never extracts. For read-only observation of an arbitrary file, folder, drive tree or ZIP, use `src/local_source_model.ts#observeLocalSourceModel` (ADR-036), which never mutates the source.

`skipped-noninjectable` means taxonomy `injectable: false` after classify (typically path-pattern `test`/`script`, or remaining `unknown`). Incidental prose substrings must not produce those skips (ADR-018). Every run — including dry-run — writes `coverage-report.json` under `outDir` with `skipped.binary`, `skipped.nonInjectable`, and `skipped.nonInjectableDetails` (`reason`, `artifactType`, `confidence`). The absolute report path is `coverage.reportPath`.

## Metadata

`src/schema.ts` owns the canonical metadata vocabulary. Stable consumers import shared contracts from the root or `l9-meta-injector/schema`.

## Public API

`docs/public-api-contract.json` is normative. Each entrypoint declares:

- source entry file;
- emitted runtime and declaration files;
- stability tier;
- exact runtime value inventory;
- exact declaration-only inventory.

Runtime values and erased TypeScript declarations are validated independently. The root is orchestration-first. Stable subpaths are semver-governed. Experimental subpaths remain explicit rather than accidental. Unlisted paths are internal.

## Repository model

`src/repository_model.ts` is normative for `l9.repository-model` egress. The packet shell,
payload domains, canonical serialization, and semantic-hash rules mirror the bound
`l9-constellation-topology` consumer revision recorded in `docs/topology-conformance.json`.

Source revision is explicit and never inferred. Capabilities and relationships require
evidence; unsupported domains stay empty and are reported as diagnostics. Producer-side
validation must pass before a bundle is written.

An assertion's subject is a repository ID or an artifact ID from the same packet, and
`src/repository_model.ts#artifactIdFor` is the only implementation of artifact identity.
Interpretation resolves the subject from `Extractor.subjectScope`, defaulting to
`repository`; the packet builder preserves whatever subject arrives, and validation
rejects any subject that resolves to neither.

## Corpus intelligence

`src/corpus_analysis.ts` is normative for `l9.corpus-index/v1`. It is a projection: every
value derives from the acquisition observation, the emitted packet, or the two duplicate
analyses, and no source file is read.

Three classes stay distinct and must not be conflated:

| Class | Basis | May be stated as |
|---|---|---|
| fact | equal content hashes | "exact duplicate", "byte-identical" |
| candidate analysis | lexical similarity at a stated threshold | "candidate", "lexical similarity" |
| source-declared | an explicit declaration with a cited line | what the document says about itself |

A near-duplicate candidate must never be rendered as a duplicate, as shared topic or
project, as supersession or redundancy, or as a recommendation to merge or delete. A
cluster's representative must never be described as a keeper or canonical copy.
`DUPLICATE_OF` is a corpus-index relation and is deliberately absent from
`RepositoryModelEdgeType`, which is a vocabulary shared with topology.

## Distribution

`docs/package-contract.json` governs the npm tarball. Committed `dist/` must equal an isolated build. The packed `dist/` set must equal committed `dist/`. Runtime, declarations, and deep-import rejection are tested from the installed tarball.

## Publication

`docs/package-publication-decision.json` governs publication readiness. Unresolved registry history, constellation consumption, or approval blocks `npm publish` without blocking local validation or `npm pack`.

## Invariants

- file bodies remain byte-preserved by injection;
- verification and coverage are observable;
- the TypeScript engine is authoritative;
- the legacy Python engine is reference-only;
- public exports cannot drift without contract and test changes;
- release evidence must bind to the tested commit and integrated main revision separately.
