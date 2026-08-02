# ADR-025: Materialize deterministic metadata in one central JSONL index

- **Status:** Accepted
- **Date:** 2026-08-01

## Context

Carrier policy classifies source, configuration, tests, workflows, infrastructure,
structured data, and most other non-L9 prose as `central_manifest`. The repository
therefore needs one deterministic materialization target rather than adjacent YAML
sidecars, per-file logs, or machine-specific report paths.

## Decision

The canonical repository index is `.l9/metadata-index.jsonl` with one canonical JSON
record per non-`hard_skip` path. Records use `l9.metadata-index/v1`, are sorted by
repository-relative POSIX path, recursively sort metadata object keys, require
lowercase SHA-256 content hashes, end with a newline, and contain no run timestamps,
absolute paths, or report locations.

Normal discovery never descends into `.l9`; authority loading and the dedicated
control-surface scan remain separate. Materialization is idempotent: unchanged bytes
cause no rewrite. New adjacent sidecars and inject logs are disabled by default.
Explicit opt-in remains possible only where a legacy or migration contract requires it.

## Consequences

- Source and configuration metadata has one queryable source of truth.
- Repeated runs on equivalent repository content produce identical index bytes.
- Generated metadata cannot recursively rediscover itself.
- Existing unmanaged sidecars are not deleted by this change.
- Carrier dispatch into the apply pipeline remains a separate integration item.
