# ADR-054: Pipeline identity is path-derived and duplicate-refusing, classification is boundary-safe, and carrier tiers gate the subject lifecycle

## Status

Accepted

Amends [ADR-018](018-classification-injectability-coverage.md).
Consumes, and does not reopen, [ADR-051](051-inventory-derived-annotation-fields.md),
[ADR-052](052-semantic-foundation-binding.md), and
[ADR-053](053-semantic-binding-propagation.md).

## Date

2026-10-05

## Context

A dry-run over a real repository produced colliding and unstable file identities,
flattened diff paths, and injectable generated or keyword-promoted files.

1. `id` was the basename stem. `src/index.ts` and `lib/index.ts` shared one id, and
   dropping the extension made `config.ts` and `config.json` the same id too.
2. Reconcile treated `id`, `source_path`, `content_hash`, and `token_cost_estimate`
   like prose: a stale value could survive a later run.
3. Dry-run diffs were `<outDir>/<basename>.diff`, so two `index.ts` files wrote one diff.
4. Path-segment checks missed a top-level folder, and every non-prose file was `source`.
5. Two keyword hits could promote prose to skill, playbook, kernel, or doctrine.
6. `hard_skip` still became a metadata subject, and `inventory_only` was still injected.

ADR-018's word-boundary demotion of test and script stays. ADR-051 owns inventory
derivation, ADR-052 owns the v2 binding, and ADR-053 owns owner, namespace-glob
refusal, and run provenance.

## Decision

1. The id stem is the repo-relative POSIX path. Each segment uses the same character
   rules as `toSnakeStem`, which still strips extensions and stays exported. The final
   extension is appended as `__` plus its normalized form. The segment normalizer
   collapses underscore runs, so it cannot emit `__`. That keeps `file.md`
   (`file__md`) distinct from an extensionless `file_md`. Joining the extension with
   a single `_` would make those two the same id, so it is not used. `config.ts` and
   `config.json` succeed as `config__ts` and `config__json`. `notes.md` and
   `notes.txt` succeed as `notes__md` and `notes__txt`. An absolute input uses the
   basename, matching `stableSourcePath`, and that basename still keeps the suffix.
   A file's id does not change when a sibling is added. There is no registry.
2. Snake-case is not injective. `a-b.md` and `a_b.md` both become `a_b__md`.
   `runPipelineAsync` throws
   `DUPLICATE_METADATA_ID: <n> id(s) map to more than one path: <id>: <pathA>, <pathB>; …`
   before any diff, injection, or coverage-report write. The message names every
   conflicting path. No source bytes change.
3. Both reconcile paths recompute `id`, `source_path`, `content_hash`, and
   `token_cost_estimate`. The action is `revise` with reason `derived field recomputed`,
   or `keep` when the values are equal. List-union and prose materiality are unchanged.
4. A dry-run diff is `<outDir>/<source_path>.diff`. Parent directories are created.
   A resolved path outside `outDir` is refused.
5. `classify` receives the repo-relative path, and segment checks use a leading slash.
   Non-prose files stay `source` unless `classifyArtifact` says `test_suite`, or
   `fixture` on a fixture or mock path segment (`test`), or `script` with a shell
   extension or a `script(s)/` segment (`script`). Keyword-only skill, playbook,
   kernel, and doctrine become `context` at the same confidence. Dot-convention,
   `prompt-`, and path tiers are unchanged.
6. `hard_skip` stops before `buildMeta` and before `metadataSubjects`. It may only
   contribute to scan and coverage accounting, with reason `carrier_hard_skip`.
   `inventory_only` remains a metadata subject and is never injected, with reason
   `carrier_inventory_only`. Tests, scripts, and fixtures stay
   `taxonomy_non_injectable`. The only contract widening is
   `NonInjectableSkipDetail.reason`. The helper that reads the first two carrier
   tiers is exported from `mutation_policy.ts` and is not a public API name.

## Consequences

- Existing ids change. A governed `check` reports stale ids until `apply` rewrites
  them. That drift is intended.
- Files that differ only by extension inject. Only a normalization collision refuses
  the run.
- `dist/`, `vendor/`, and other inventory-only surfaces are indexed and not annotated.
  Protected and binary paths do not become metadata subjects.
