# Migration from v2 to v3

Version 3 replaces the accidental broad root barrel with explicit entrypoints.

## Orchestration

No change:

```ts
import { runPipelineAsync } from "l9-meta-injector";
```

## Inventory

```ts
// v2
import { inventoryTree } from "l9-meta-injector";
// v3
import { inventoryTree } from "l9-meta-injector/inventory";
```

## Schema and MetaV3

```ts
// v2
import { buildMetaV3, coerceNormalizedMeta } from "l9-meta-injector";
// v3
import { buildMetaV3, coerceNormalizedMeta } from "l9-meta-injector/schema";
```

## Low-level composition

```ts
// v2
import { injectFile, compilePlacementPlans } from "l9-meta-injector";
// v3
import { injectFile, compilePlacementPlans } from "l9-meta-injector/advanced";
```

## LLM adapter controls

```ts
// v2
import { setAdapter, resetAdapter } from "l9-meta-injector";
// v3
import { setAdapter, resetAdapter } from "l9-meta-injector/advanced/llm";
```

Replace repository-internal deep imports with the nearest supported entrypoint. Deep imports are no longer resolvable.
