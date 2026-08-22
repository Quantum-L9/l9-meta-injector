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

An assertion attaches to the subject the interpretation pass gave it, and the packet
builder preserves that subject rather than rewriting it to the repository. The subject
must be a repository or an artifact this packet emits; an assertion naming neither fails
producer-side validation. `Extractor.subjectScope` selects the scope and defaults to
`repository`, so an extractor's scope changes only when the extractor says so. Artifact
identity comes from `repositoryModelArtifactId`, which packet building and interpretation
share so the two cannot drift apart.

Scope is not a wire change: `subject_id` is an unconstrained string on both sides of the
contract, so `l9.repository-model` stays at `1.1.0`. The interpretation profile version
moves whenever extraction rules change, and through it the semantic identity of every
packet built with interpretation.

## Corpus analysis

`src/corpus_analysis.ts` and `src/corpus_report.ts` are normative for `l9.corpus-index/v1`.
They are a projection: every value derives from the acquisition observation, the emitted
packet, the exact-duplicate clustering, or the near-duplicate analysis, and every artifact,
assertion, relation endpoint and candidate endpoint must resolve against the packet.

Two epistemic classes stay apart. An exact duplicate is content-hash equality and is
stated as a fact; `DUPLICATE_OF` is rendered here rather than in the packet, because the
bound consumer's edge vocabulary does not own that edge and no existing edge type may be
reused to mean it. A near-duplicate is a `text-near-duplicate/v1` score at a stated
threshold and is a candidate: it establishes shared wording and nothing about topic,
project, supersession, or what should be done. The cluster representative is a rendering
anchor and never a recommendation.

Both outputs are byte-deterministic — code-point key ordering, no wall clock, no absolute
or scratch path — and neither is ever written inside the observed source.

Full semantics: `docs/corpus-intelligence.md`.

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
