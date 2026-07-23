# Active Contracts

## Pipeline

`src/pipeline.ts#runPipelineAsync` is the stable orchestration contract. It accepts `PipelineConfig` and returns `PipelineResult`, including verification, coverage, placement plans, MetaV3 records, and metrics.

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
