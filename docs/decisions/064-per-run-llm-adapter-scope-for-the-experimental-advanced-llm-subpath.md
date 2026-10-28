# ADR-064: Per-run LLM adapter scope for the experimental advanced/llm subpath

## Status

Accepted

Amends [ADR-013](013-orchestration-first-public-api.md) (documented semantics of
the experimental `l9-meta-injector/advanced/llm` subpath; no entrypoint or exported
name changes).

## Date

2026-10-28

## Context

`src/llm.ts` held one module-level adapter slot (`_active`) behind `setAdapter`,
`getAdapter` and `resetAdapter`. `runPipelineAsync` installed its run's adapter in
that slot at run start (`setAdapter(makeOpenAIAdapter(... onDiagnostic:
metrics.onLlmDiagnostic))`, or `resetAdapter()` without complete credentials), and
`runSkillsPipelineAsync` did the same except that it left the slot alone when the LLM
was enabled without credentials. Neither restored the slot. Every consumer reads
`getAdapter()` lazily after await points (`src/assist.ts`, `src/reconcile_fields.ts`,
`src/inject.ts`, `src/skills_pipeline.ts`, and `estimateTokens` in `src/extract.ts`)
(RC-018, finding F-032).

Consequences observed at the audited revision:

- Concurrent runs cross-wired: with run B on endpoint X (key B) and run C on endpoint
  Y (key C) started together, X received 1 request and Y received 11, all with key C;
  B's metrics counted 1 call and C's counted 11. Run B's content reached C's endpoint
  under C's credential.
- An LLM run concurrent with a run that had the LLM disabled lost its adapter
  mid-run (`decisionPaths.no_adapter = 5`).
- A finished run leaked: after a credentialed pipeline run on X, a later skills run
  with the LLM enabled and no credentials sent two requests to X with the earlier
  run's key, while reporting `llmCalls = 0` because the leaked adapter still reported
  to the earlier run's metrics collector.
- A caller-installed adapter was discarded by every pipeline run.

`docs/public-api.md` documented the adapter as process-global and told concurrent
callers to isolate processes or serialize adapter changes, but the root API, which
promises not to expose adapter mutation, mutated the global itself, so a root-only
caller had nothing to serialize. The sequential leak was covered by no documented
limitation.

## Options Considered

### Option A: AsyncLocalStorage run scope inside `src/llm.ts`

- Pros: no signature or export change; every lazy `getAdapter()` consumer becomes
  run-correct without edits; `setAdapter` remains the out-of-run default; uses
  `node:async_hooks`, already available on the supported `engines.node >=18`, so no
  new dependency.
- Cons: a small documented semantic change of an experimental subpath; correctness
  depends on async context propagating across the run's promise chain.

### Option B: Thread the adapter explicitly through every consumer

- Pros: most explicit; no ambient state.
- Cons: changes many experimental `./advanced` signatures (`assistField`,
  `reconcileFieldsAsync`, `injectFileAsync`, `estimateTokens`, skills helpers) and
  every internal call site; largest diff.

### Option C: Keep the global, save and restore around each run, document no concurrency

- Pros: smallest change.
- Cons: fixes only the sequential leak; concurrent root-API runs still cross-wire
  credentials; contradicts the root contract that the root does not expose adapter
  mutation.

## Decision

The owner adopted **Option A**.

1. `src/llm.ts` keeps the process-global slot and adds an internal async-context
   scope (`AsyncLocalStorage` from `node:async_hooks`). `getAdapter()` returns the
   current run scope's adapter when one exists, otherwise the process-global.
   `setAdapter` and `resetAdapter` keep their global semantics. The scope helper
   (`runWithAdapter`) is internal and is not re-exported from `src/public/llm.ts`.
2. `runPipelineAsync` creates its metrics collector, then runs its whole body inside a
   scope holding the run's adapter: the OpenAI adapter when `llmEnabled` and the base
   URL, key and model are all present, otherwise `localAdapter`. It no longer calls
   `setAdapter` or `resetAdapter`.
3. `runSkillsPipelineAsync` scopes the OpenAI adapter on complete credentials and
   `localAdapter` when the LLM is disabled. With the LLM enabled and incomplete
   credentials it opens no scope, so the adapter a caller installed with `setAdapter`
   is consulted, as before.
4. Installing an adapter with `setAdapter` from inside a running pipeline does not
   take effect for that run. That pattern is unsupported.

## Consequences

- Each run uses only its own adapter, endpoint, credential and metrics collector;
  concurrent runs in one process no longer cross-wire, and `getAdapter()` returns the
  same value before and after any run, whether it completes or throws.
- Behaviour changes, no API change: `runPipelineAsync` no longer resets a
  caller-installed global adapter; `getAdapter()` called from code running inside a
  run returns that run's adapter. Sequential single-run callers see identical
  results. `docs/public-api-contract.json` is unchanged.
- `docs/public-api.md` (the "process-global" sentence under advanced caller
  obligations and the `advanced/llm` row) and `docs/architecture.md` (the
  `advanced/llm` row) need their wording updated to "process-global default adapter;
  each run uses its own scoped adapter". That edit is made with this decision's
  integration.
- Corpus embedding HTTP clients are a separate client and are not affected.
- Tests: `tests/llm_run_scope.test.ts` (`REG-WU-014-RC-018-a` … `-f`).
