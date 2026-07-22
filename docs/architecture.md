# Architecture

## Authority

The TypeScript pipeline under `src/` is the sole active engine. `runPipelineAsync` owns the complete classify, extract, assist, inject, verify, report, placement, MetaV3, and indexing sequence. The Python consolidation engine under `tools/consolidation/` is historical reference material and is neither shipped nor CI-gated.

## Package boundary

Version 3 exposes five code entrypoints:

```text
l9-meta-injector                stable orchestration root
l9-meta-injector/inventory      stable standalone inventory
l9-meta-injector/schema         stable metadata contracts
l9-meta-injector/advanced       experimental composition primitives
l9-meta-injector/advanced/llm   experimental process-global adapter controls
```

`docs/public-api-contract.json` defines exact runtime and declaration inventories. `package.json#exports` derives from that contract. Unlisted deep imports are denied.

## Runtime path

```text
retrieval -> extraction -> classification -> normalization
          -> optional assist -> injection -> verification
          -> deduplication -> placement -> MetaV3 -> indexes
```

The stable root keeps callers on the full path. Low-level primitives remain available only through an explicitly experimental subpath whose caller obligations are documented.

## Distribution

Source compiles to committed `dist/`. `check:dist` rebuilds in isolation and compares every JavaScript file, declaration, and source map. `test:packed` creates the npm tarball, enforces the package contract, installs it in a clean consumer, executes every supported runtime entrypoint, compiles every declaration entrypoint, and confirms deep imports fail.

## Validation

```bash
npm ci
npm run validate
```

The canonical command checks types, Jest, public API, architecture authority, deterministic manifest, distribution parity, selfpack, and packed consumption. CI then asserts the checkout remains clean.

`npm publish` is separately fail-closed through `check:publication` while external distribution history is unresolved.
