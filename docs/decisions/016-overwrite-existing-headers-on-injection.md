# ADR-016: Injection overwrites existing headers, including legacy formats

## Status

Accepted

## Date

2026-07-29

## Context

Injection is idempotent for the current v3 sentinel block: `readForInjection` strips the
injector's own header (YAML frontmatter, or the `>>> l9:meta >>> … <<< l9:meta <<<` comment
block) before writing a fresh one, so re-runs are byte-stable.

It did not, however, recognize **legacy** metadata headers. The historical consolidation-v1
engine stamped `L9_META` and `L9_ARTIFACT_META` blocks (e.g. `# --- L9_META --- … # --- /L9_META ---`,
`<!-- L9_META … /L9_META -->`). Because `stripInjectedBlock` / `stripExistingFrontMatter` only
match the v3 formats, a legacy block survived in the clean body and the fresh v3 header was
written **above** it. A repository previously stamped by the old engine therefore ended up with
two coexisting, divergent metadata blocks per file — observed live against `cryptoxdog/eie-ingest`,
where all four `eie_ingest/*.py` files carried both a v3 header and a stale `l9_schema: 1` block.

An injected file must carry exactly one authoritative header. Stacking, appending, or preserving
a stale header is not acceptable.

INV-003 permits injection to "add or update governed metadata" while forbidding silent rewrites
of the underlying body. A legacy `L9_META` block is governed metadata, not body, so replacing it
is squarely an update — provided genuine body content (code, docstrings, prose, license text) is
never touched.

## Options Considered

### Option A: Leave the behavior as-is (recognize only the v3 header)

- Pros: no change; v3-on-v3 idempotency already holds.
- Cons: repositories carrying legacy headers accumulate duplicate, conflicting metadata; the
  injected file is not clean; migration from consolidation-v1 is never completed.

### Option B: Merge legacy field values into the new header

- Pros: preserves prior field values.
- Cons: legacy and v3 taxonomies diverge; merging propagates stale/incompatible fields; result is
  neither a faithful legacy header nor a clean v3 header; contradicts "overwrite, never preserve".

### Option C: Overwrite — strip any leading legacy header, then write one fresh v3 header

- Pros: injected file is always clean with exactly one header; completes migration off the legacy
  format; keeps idempotency; honors INV-003 by touching only governed metadata.
- Cons: legacy field values are discarded (by design); a legacy block must be reliably distinguished
  from body content.

## Decision

We choose **Option C**. Before injecting, the clean body has any **leading** legacy
`L9_META` / `L9_ARTIFACT_META` block removed (`stripLeadingLegacyMetaBlock` in `src/comment.ts`),
in addition to the existing removal of the injector's own header. The freshly built v3 header then
replaces it. Stripping is confined to the head of the body (after an optional shebang) and to
sentinel-delimited blocks, so mid-file prose that merely mentions the token — including documentation
examples — is never altered. Stacked legacy blocks are all removed. This is the default behavior;
there is no opt-out flag.

## Consequences

- An injected file carries exactly one header. Legacy `L9_META` / `L9_ARTIFACT_META` blocks are
  overwritten, never appended to or preserved beneath the new header.
- Legacy field values are intentionally not carried forward; the v3 header is authoritative.
- Body preservation (INV-003) is unaffected: `originalBodyHash`, `verify`'s `bodyPreserved`, and
  re-run idempotency are all computed against the post-strip clean body, and genuine body content is
  preserved verbatim. Re-injection remains byte-stable.
- Only sentinel-delimited blocks at the head of the file are removed; an unterminated opener or a
  mid-file mention is left verbatim, so false-positive stripping of real content is avoided.
- Regression coverage: `tests/inject_overwrite_legacy_header.test.ts`.
