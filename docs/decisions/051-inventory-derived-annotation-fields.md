# ADR-051: Inventory annotation fields are derived or Unknown

## Status

Accepted

Amends [ADR-049](049-inventory-archive-member-annotation.md): inventory headers still
harvest existing meta, emit three clocks, and write adjacent sidecars and admitted
archive members. The identity fields on those carriers are no longer stamped with
inventory-mode constants.

## Date

2026-10-04

## Context

`npm run inventory` annotates an arbitrary folder without `.l9/meta-authority.yaml`.
The default header mixed three epistemic classes in one flat bag:

- measured facts (`content_hash`, the three clocks)
- inferred classification (`inventory_type`, `classification_confidence`, `evidence`)
- constants (`artifact_type: source`, `namespace: inventory`, `authority: inventory`,
  `token_cost_estimate: 0`, and the MCP projections)

`token_cost_estimate: 0` is a false measurement. `authority: inventory` is a writer
binding no authority document backs. `content_hash` digested the file including a
previous run's header, so the field never described the current body and changed on
every re-run. Harvest then re-emitted the old constants, so a live corpus could not
migrate.

Pipeline classification (`classify` → `PRIMITIVE_TAXONOMY`), `resolveNamespace`,
`estimateTokens`, and `injectFile`'s carrier-free body hash already existed.

## Options Considered

### Option A: Keep constants and add a second inventory taxonomy

- Pros: no change to already-written headers.
- Cons: invents a mapping table; leaves false measurements and a fake authority in
  place; contradicts the repository's derive-or-Unknown rule.

### Option B: Derive from existing authorities, else Unknown

- Pros: one taxonomy, one hash, one token estimator; harvested operator values
  survive; legacy placeholders migrate on the next run.
- Cons: headers already written with `namespace: inventory` change on re-inventory;
  `content_hash` meaning changes for UTF-8 text files.

### Option C: Require `--namespace` / `--authority` flags

- Pros: explicit operator identity.
- Cons: inventory remains usable without a repository authority file; the operator
  chose not to add flags. Absence must stay `Unknown`, not a guessed default.

## Decision

We choose **Option B**.

1. **Taxonomy is one derived unit.** Effective `artifact_type` is a harvested
   non-legacy `ArtifactType`, else `classify` on a readable UTF-8 regular file, else
   `Unknown`. `mcp_primitive`, `callable`, `retrievable`, and `injectable` always
   project from that type through `PRIMITIVE_TAXONOMY` (`retrievable` equals
   `injectable`, as in `buildMeta`). Folders, symlinks, special files, binaries, and
   archives emit `Unknown` for every content-derived field.
2. **`sharing_scope`** is a harvested non-legacy value, else
   `resolveNamespace(...).sharingScope` for a readable file, else `Unknown`.
3. **`token_cost_estimate`** is `estimateTokens(body)` for a readable UTF-8 file
   within `hashMaxBytes`. A harvested estimate is never reused. Otherwise `Unknown`.
4. **`namespace` and `authority`** are a harvested operator value that is not the
   legacy placeholder `inventory`, otherwise `Unknown`. Inventory still does not
   require `.l9/meta-authority.yaml`.
5. **`content_hash`** for a UTF-8 regular file is the SHA-256 of the body with the
   L9 managed carrier removed (the same bytes `injectFile` already hashed as
   `originalBodyHash`). Binaries, archives, and oversize files keep the raw-byte
   hash. Duplicate clusters therefore still match after annotation.
6. **Clock skew is a diagnostic, not a rewrite.** If `created_at` or `modified_at`
   is later than `inspected_at`, the record gains
   `clock_skew:<clock>_after_inspected_at`. The observed values stay.
7. **Legacy placeholders are stripped on harvest.** A documented table holds the
   exact pre-change literals. A harvested value equal to its literal is discarded
   before precedence runs, so an already-annotated tree migrates.

Placement, sentinels, body preservation, the three clocks, root-relative
`source_path`, `inventory_type`, and the `--schema` path are unchanged.

## Consequences

- A second inventory of a previously annotated tree rewrites placeholder fields to
  derived or `Unknown` values and restabilizes `content_hash`.
- `inventory_type` (ArtifactInventory) and `artifact_type` (pipeline taxonomy)
  remain two fields; `source` still means "source or config file".
- Archive sidecar hash churn from changing `inspected_at` remains an ADR-049
  consequence.
- Self-declared `status: LOCKED` artifacts are still annotated. Honouring that
  declaration is future work.
- Recalibrating `classification_confidence` is a taxonomy-wide change, not this
  one.
- Grouping the flat header into planes is refused: the constrained YAML subset
  only supports depth 2.

## Future work

- Do not write an inline header into an artifact that declares itself `LOCKED`;
  record a `declared_locked` diagnostic and prefer a sidecar or observation-only
  disposition.
- Recalibrate inventory classification confidence so extension-only evidence is
  not presented as 0.8.
- Group annotation fields into observed / inferred / asserted planes if the
  carrier format is later allowed to nest.

## Amends

ADR-049 header-field and `content_hash` semantics for inventory annotation.
The harvest-first, three-clock, always-sidecar, and archive-member decisions
stand.
