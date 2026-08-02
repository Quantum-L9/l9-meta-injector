# ADR-024: Metadata carriers are explicit, ordered policy decisions

- **Status:** Accepted
- **Date:** 2026-08-01

## Context

The historical injector selected a serialization strategy from file syntax and
then wrote inline blocks or adjacent sidecars. Syntax compatibility is not an
authority decision. Source code, configuration, workflows, tests, infrastructure,
structured data, generated outputs, and L9-managed prose have materially
different ownership and corruption risks.

The hardening plan requires four explicit carrier classes:

1. `hard_skip`
2. `inventory_only`
3. `central_manifest`
4. `inline_managed`

## Decision

`src/mutation_policy.ts` is the sole carrier-policy resolver. Discovery produces
subjects; this resolver produces exactly one terminal carrier decision for every
subject before later stages plan any metadata mutation.

Precedence is safety-first:

1. Protected internals, injector outputs, dependency trees, and binary/media
   content are `hard_skip`.
2. Generated, vendored, environment-managed, and lock-state artifacts are
   `inventory_only`.
3. Source, tests, scripts, workflows, configuration, infrastructure, and
   structured formats are `central_manifest`.
4. `inline_managed` is available only to an approved L9 prose artifact type and
   an explicit safe `inline_allow` path match.

`default_carrier: inline_managed` does not grant blanket inline authority. It
still requires an explicit allow match. `skills` mode does not bypass repository
authority.

Authority path patterns are repository-relative POSIX globs. Absolute paths,
traversal segments, negation, backslashes, duplicate separators, leading `./`,
control characters, and oversized patterns are invalid.

## Consequences

- A broad allow pattern cannot make source or configuration inline-mutable.
- Generic documentation remains in the central manifest unless it is classified
  as an approved managed L9 artifact and explicitly allowed.
- Carrier selection is deterministic, path-sorted, and coverage-checkable.
- P-202 may implement `.l9/metadata-index.jsonl` using these decisions without
  inventing a second policy engine.
