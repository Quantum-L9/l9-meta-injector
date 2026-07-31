# ADR-018: Classification injectability gate and coverage report persistence

## Status

Accepted

## Date

2026-07-31

## Context

Pipeline dry-runs on in-scope markdown trees reported high `skippedNonInjectable` counts for files that were clearly scanned text (yaml-frontmatter strategy), not binary and not omit-protected. Root causes:

1. Keyword matching used substring `includes`, so `testing` / `specification` / `specific` / `tooling` poisoned the bag into `test` or `script`.
2. Any keyword score ≥ 1 could select a non-injectable type (`test` / `script`).
3. Unscored prose fell through to `unknown`, which is taxonomy-non-injectable.
4. Coverage path lists existed in memory but were not persisted on dry-run, so skips were hard to inspect after the fact.

## Options Considered

### Option A: Make `test` / `script` / `unknown` injectable in `PRIMITIVE_TAXONOMY`

- Pros: immediate coverage boost.
- Cons: weakens intentional exclusion of real test/script artifacts from injection/indexes; papers over classifier bugs.

### Option B: Inject whenever a write strategy resolves, ignore taxonomy.injectable

- Pros: maximizes header coverage.
- Cons: severs taxonomy from pipeline policy; breaks OBS-003 semantics and existing `/tests/` skip contracts.

### Option C: Harden classification + demote weak non-injectable keyword wins + default prose to `context`; persist coverage reports always

- Pros: keeps taxonomy injectable flags; path-pattern `/tests/` and `/scripts/` still skip; in-scope prose injects; skips remain diagnosable.
- Cons: slightly more classifier logic; keyword-only `test`/`script` needs a higher bar.

## Decision

We choose **Option C**.

1. Taxonomy keyword hits use word-boundary matching on lowercased text.
2. Keyword-only `test` / `script` require score ≥ 2 **and** either a strong companion (`fixture`/`mock` for test; `utility`/`helper` for script) or score ≥ 3; otherwise demote to the best injectable type or `context`.
3. Path-pattern and dot-convention assignment of `test` / `script` unchanged (high confidence, non-injectable).
4. Zero-hit frontmatter prose defaults to injectable `context`, not `unknown`.
5. Pipeline always writes `coverage-report.json` under `outDir` (including dry-run), with `skipped.nonInjectableDetails` carrying `reason` / `artifactType` / `confidence`.

## Consequences

- False-positive skips from incidental prose substrings drop sharply.
- Callers can inspect skip reasons after dry-run without re-classifying.
- Public API gains `NonInjectableSkipDetail` and enriched `CoverageSummary`.
- Real test/script trees under conventional paths remain skipped.
