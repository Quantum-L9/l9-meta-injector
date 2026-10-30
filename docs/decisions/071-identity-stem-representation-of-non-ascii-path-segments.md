# ADR-071: Identity stem representation of non-ASCII path segments

## Status

Accepted

Amends [ADR-054](054-pipeline-identity-and-carrier-lifecycle.md) Decision item 1
(identity segment character rules) and
[ADR-023](023-deterministic-identity-and-discovery-ledger.md) (deterministic
persisted identity now holds across Unicode normalisation forms).

## Date

2026-10-28

## Context

ADR-054 item 1 makes the metadata id stem the repo-relative POSIX path, with each
segment following "the same character rules as `toSnakeStem`". In
`src/namespace.ts`, `snakeSegment` replaced every character outside `[a-z0-9_]` with
`_`, collapsed and trimmed underscores, and `identityStem` dropped empty segments
(RC-023, finding F-103). Non-ASCII characters were therefore erased:

- `docs/日本.md`, `docs/中文.md` and `docs.md` all became `l9.context.docs__md`;
- `notes/résumé.md` and `notes/r_sum.md` both became `l9.context.notes_r_sum__md`;
- `é/x.md` and `x.md` both became `l9.context.x__md`.

ADR-054 item 2 then refused the whole run with `DUPLICATE_METADATA_ID`, so any folder
holding two non-ASCII-named files was ungovernable, and a single such file carried a
misleading id (`docs/日本.md` read as `docs.md`). This is a literal consequence of the
accepted character rule rather than a deviation from it; ADR-054 considered only ASCII
hyphen/underscore collisions. Separately, the same logical name spelled in NFC on one
host and NFD on another (macOS file systems report decomposed names) could produce
different ids, which weakens ADR-023's deterministic identity.

## Options Considered

### Option A: Encode non-ASCII code points as ASCII tokens

NFC-normalise the segment, lower-case it, encode each remaining non-ASCII code point as
an ASCII token (`u` plus lowercase hex), keep the ASCII rules unchanged, and decouple
identity segments from `toSnakeStem`.

- Pros: ids stay within `[a-z0-9_.]`, so no consumer sees a new character set; ASCII
  ids are unchanged; `toSnakeStem` (a public advanced export) is untouched; remaining
  collisions stay fail-closed under ADR-054 item 2.
- Cons: non-ASCII ids change once and are less readable.

### Option B: Preserve Unicode letters and numbers

- Pros: readable ids.
- Cons: widens the id character set for every consumer (YAML headers, the central
  index, v3 records, downstream semantic registries) and the namespace format
  assertions; locale-dependent case folding and confusable characters.

### Option C: Keep the lossy rule and document it

- Pros: no id change.
- Cons: repositories with non-English names stay ungovernable whenever two names
  collapse, and misleading ids persist.

## Decision

The owner adopted **Option A**.

1. Identity segments no longer share `toSnakeStem`'s character rules for non-ASCII
   input. For each path segment and for the extension, `snakeSegment`:
   1. normalises the segment to NFC;
   2. applies the existing camel-case split and turns hyphen and whitespace runs
      (including non-ASCII whitespace, as before) into `_`;
   3. replaces each non-ASCII code point with `_u<hex>_`, where `<hex>` is the
      lowercase hexadecimal code point of its lower-case form; a lower-case form that
      is ASCII stays a plain character, and a lower-case form of several code points
      encodes each one;
   4. applies the existing ASCII rules unchanged: other characters become `_`,
      underscore runs collapse, leading and trailing `_` are trimmed, and the result is
      lower-cased.
2. Examples: `docs/日本.md` is `docs_u65e5_u672c__md`, `docs/中文.md` is
   `docs_u4e2d_u6587__md`, `notes/résumé.md` is `notes_r_ue9_sum_ue9__md`, `é/x.md` is
   `ue9_x__md`, and `x.日本` is `x__u65e5_u672c`. `É.md` and `é.md` share one id, as
   `README.md` and `readme.md` already do, and the composed and decomposed spellings of
   `résumé` share one id.
3. Ids stay within `[a-z0-9_.]`. Underscore runs still collapse, so the segment
   normaliser still cannot emit `__` and the extension separator stays unambiguous.
4. ASCII-only paths keep byte-identical ids. `toSnakeStem` keeps its current output and
   is not part of identity.
5. A token can still collide with a literal ASCII name (`u65e5.md` beside `日.md`).
   Such a collision refuses the run before any write under ADR-054 item 2.

## Consequences

- Distinct paths that differ only in non-ASCII characters get distinct, deterministic,
  platform-stable ids; repositories that were refused become governable.
- Persisted ids of files whose path contains non-ASCII characters change once. A
  governed `check` reports them stale until `apply` rewrites them, the same accepted
  drift as ADR-054's consequences (item 3 recomputes derived fields). No migration tool
  is provided.
- `resolveNamespace(...).idStem` on the experimental advanced subpath returns the new
  stems for non-ASCII inputs; its signature is unchanged. Namespaces and primitive
  folders are not affected.
- Tests: `tests/namespace_unicode_identity.test.ts` (`REG-WU-016-RC-023-a` … `-i`).
