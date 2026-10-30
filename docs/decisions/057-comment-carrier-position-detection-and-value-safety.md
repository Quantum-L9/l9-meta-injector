# ADR-057: Comment-carrier position, managed-block detection and value safety

## Status

Accepted

## Date

2026-10-28

## Amends

- [ADR-024](024-explicit-metadata-carrier-policy.md): the governed carrier policy is
  unchanged; this ADR fixes the bytes the ungoverned comment-carrier writers produce.
- [ADR-035](035-unsupported-inline-carrier-falls-back.md): its fall-back-instead-of-abort
  principle now also covers files whose language leaves no inert comment position.

## Context

`src/comment.ts` promises to "annotate ANY text filetype without corrupting it"
(lines 2-3) and to keep "file body … parseable" (line 70). INVARIANTS.md INV-003 requires
injection to preserve the body and to be idempotent. The remediation audit at
`bf66978` found three ways the comment carrier broke those promises:

- **RC-001 (F-001, F-095).** `applyCommentInjection` (`src/comment.ts:214-226` at
  `bf66978`) wrote the block at byte 0 unless line 1 began with `#!`. An XML/SVG/XSL
  declaration, a `<?php` open tag, a PEP 263 or Ruby encoding cookie, a CSS `@charset`
  rule and Dockerfile parser directives must come first, so the written files were
  invalid (`xmllint`: "XML declaration allowed only at the start"), changed meaning
  (`php`: strict_types fatal error, or metadata printed as page output; the latin-1
  cookie pushed past line 2) or silently lost their directives. The prefix table mapped
  `.ql` to `#` (not a QL comment) and `.sass` to an unindented `/*` block (live code in
  the indented syntax). A shebang with no newline gained a terminator that strip never
  removed, so `bodyPreserved` was false on the first run and the extra byte became part
  of the body on the second.
- **RC-002 (F-002).** `stripInjectedBlock`, `hasInjectedBlock` and
  `extractInjectedYaml` used an unanchored lazy regex (`src/comment.ts:156-202` at
  `bf66978`). The first sentinel pair anywhere in the file was treated as the managed
  block, so sentinel text in a body (fixtures, string literals, docs about this tool)
  was deleted on injection, and because every body hash was computed after the same
  strip the loss was invisible to `bodyPreserved` and `verify`.
- **RC-003 / RC-005 (F-022, F-023).** Carrier values were written verbatim into host
  comments and the canonical serializer was not the complement of the canonical parser.
  See the WU-002 section below.

The governed `check`/`apply` path never writes a comment carrier (ADR-024 routes every
comment- and sidecar-strategy subject to `central_manifest`), so these defects affect
the ungoverned writers: `runPipelineAsync` in write mode (`scripts/pipeline-cli.js`),
`inventoryTree` header annotation and its clock rewrites, and the experimental
`./advanced` exports.

## Options Considered

### DEC-RC-001 — where the block goes when a file has a mandatory prologue

#### Option A: Prologue-aware placement, sidecar only where no inert position exists

- Pros: files stay annotated inline; previously damaged files repair themselves on the
  next run; one offset definition keeps inject and strip symmetric; governed path untouched.
- Cons: `comment.ts` needs prologue grammar knowledge.

#### Option B: Static sidecar routing by extension (all PHP/XML/Sass to sidecars)

- Pros: smallest table change.
- Cons: every PHP/XML file moves to a sidecar (large behaviour change); damaged files
  keep their bad byte-0 block because a sidecar write never touches the source;
  cookie/`@charset`/Dockerfile still need content-aware handling.

#### Option C: Content-based sidecar for any file that starts with a prologue

- Pros: no placement logic.
- Cons: routes nearly all PHP and most XML/SVG to sidecars, leaves legacy damage in
  place, and makes the strategy content-dependent for many more languages.

### DEC-GAR-01 — the single position predicate and legacy migration

#### Option A: one predicate; strip also recognises the legacy pre-prologue position

- Pros: one run repairs every file the defective writer produced; no new command.
- Cons: strip/detect accept two head positions instead of one.

#### Option B: strict predicate, separate migration command

- Pros: a single position.
- Cons: until someone runs the command, every damaged file gains a second block.

### DEC-GAR-04 — versioning of the consumer-visible carrier change

#### Option A: minor release with release notes (bug fix to the documented contract)

- Pros: consumers stay on the maintained `v4` line (INV-023).
- Cons: on-disk carrier bytes change once for affected files without a major bump.

#### Option B: major release `v5`

- Pros: signals the byte change loudly.
- Cons: only warranted when a documented contract is broken.

## Decision

The owner adopted the recommended option of each decision.

**DEC-RC-001: Option A.** The carrier position is the first byte after every mandatory
prologue. One internal routine, `carrierPosition`, computes it and is used by
`applyCommentInjection` (insert there) and by strip, detect and extract (match there):

| Prologue (`StrategySpec.prologue`) | Files | Consumed |
|---|---|---|
| (always) | every comment strategy | a BOM, then a `#!` shebang line |
| `xml-declaration` | `.xml` `.svg` `.xsl` `.xslt` `.xhtml` | `<?xml …?>` at byte 0 through the end of its line |
| `php-open-tag` | `.php` | an optional shebang, then a bare `<?php` line |
| `encoding-cookie` | `.py` `.pyw` `.rb` | a cookie on line 1, or on line 2 when line 1 is blank or a comment (a shebang is one) |
| `css-charset` | `.css` `.scss` `.less` | a `@charset "…";` line at byte 0 |
| `dockerfile-directives` | `Dockerfile`, `.dockerfile` | leading `# syntax=` / `# escape=` / `# check=` lines |

`resolveStrategy` fills the descriptor and returns `sidecar` where no inert position
exists: a `.php` file whose first line (after a BOM, a shebang and any byte-0 legacy
block) is not a bare `<?php`, and an XML declaration or `@charset` rule that does not
end its line. It decides on the file with its managed block removed, so it answers the
same before and after injection. `.ql` now uses `//` and `.sass` a `//` line comment;
`.qls` (a YAML query suite) keeps `#`.

When the last prologue line has no terminator, insertion supplies one and writes no
newline after the block; strip recognises that shape (block ending the file right after
a prologue) and removes the supplied terminator again, so `strip(inject(x)) === x`
holds for every prologue, BOM, CRLF and no-terminator case. This also fixes the
shebang-at-EOF branch (F-095).

`applyCommentInjection` gains an optional trailing `spec` argument; without it only a
BOM and a shebang are honoured, as before, for external callers. `inject.ts` and the
two `inventory.ts` rewrite sites forward the spec they already hold. Called with a spec
that leaves no inert position, it throws instead of writing a broken file; the package
never reaches that case because `resolveStrategy` routes such files to a sidecar first
(ADR-035: fall back, do not abort the run).

**DEC-GAR-01: Option A.** The managed block is recognised only when it begins exactly at
the carrier position, or at the legacy byte-0 position after a BOM where the pre-fix
writer placed it in front of a prologue. A block is matched line by line: the exact
start sentinel line, then (for line comments) only comment lines, up to the first exact
end sentinel line. Sentinel text anywhere else is body and is preserved byte for byte,
and extraction returns `null` when there is no head block (RC-002). For `.ql` and
`.sass` the head block in the old delimiters (`#`, `/* … */`) is also recognised
(`StrategySpec.legacyCarrier`), so the first run replaces it instead of stacking a
second block. The next write-mode run therefore repairs every previously damaged file
once; a second run writes nothing.

A legacy byte-0 block in a file that is now routed to a sidecar (a PHP template) is not
removed automatically: a sidecar write never touches the source. Such files keep their
old block until an operator removes it; this is recorded here rather than silently
changing the sidecar contract.

**DEC-GAR-04: Option A.** No documented contract specified the old byte-0 placement or
the unanchored match; both contradicted the documented promise not to corrupt files
(`comment.ts`, INV-003). The change therefore ships within the maintained `v4` line as
a bug fix with release notes. The release itself requires separate authority
(INV-023); this ADR does not confer it.

**DEC-RC-003: Option A, with Option C as the defensive fallback.** (Alternatives:
A carrier-aware escaping with standard YAML double-quote escapes; B sidecar fallback per
value, rejected because verify/strip/extract derive the strategy from the file alone and
an inline-to-sidecar flip would leave a stale block; C refuse the file.)

- `carrierForbiddenSequences(spec)` in `src/comment.ts` declares what each carrier
  cannot hold: every carrier's own END sentinel text; `--` for `<!-- -->` (covers
  `-->`); `*/` and Sass interpolation `#{` for `/* */` (applied to CSS and LESS too,
  which only costs an escape); CR, U+0085, U+2028 and U+2029 for line comments (LF is
  always escaped).
- `serializeYamlObject(obj, { forbidden })` double-quotes any string containing a
  forbidden sequence and writes the first character of every occurrence as a standard
  YAML escape (`\x2D`, `\x2A`, `\x23`, ` `, …). No escape spelling contains a
  forbidden sequence, so the emitted block is free of them. Without the option the
  output is unchanged for every other caller (sidecars, frontmatter display).
- `parseCanonicalYaml` accepts `\xNN`, `\uXXXX` and `\UXXXXXXXX` inside double quotes,
  so extraction returns the exact original value. A hand-written quoted value holding a
  bare `\x41` is now read as `A`; the serializer itself never emits a bare backslash
  (it writes `\\`).
- `inject.buildInjection` and the two `inventory.ts` block rewrites pass the spec's set.
- Fallback C: a key (keys are bare in the canonical subset) or a JSON-inlined value
  that contains a forbidden sequence cannot be escaped; the serializer throws
  `CARRIER_UNREPRESENTABLE` and nothing is written. `yamlToBlock` performs the same
  check on the inner YAML it is given, so no caller can write a broken block. The
  pipeline's metadata keys are fixed identifiers that cannot hit this; inventory header
  writes record the refusal per file through their existing error path.

**RC-005 (serializer/parser complement), decided with DEC-RC-003.** `yamlScalar` quotes
every string the canonical `SCALAR` reader would not read back as the same string —
integer and decimal patterns, `~`, `null`/`true`/`false`, bracket/brace forms, edge
whitespace — and any containing LF, CR, TAB, U+2028 or U+2029, which it escapes. The
parser's comment stripper honours backslash escapes inside double quotes, so `"a\" # b"`
is no longer truncated. Benign values are byte-identical to the previous output.

**RC-024 (WU-017): the narrow YAML lexers read their subset as YAML does, or refuse.**
The carrier parser's comment stripper is one of four hand-written YAML-subset lexers
(F-104, F-105, F-106). Each keeps its own grammar — a lenient operator schema
(`meta_schema.ts`), a fail-closed authority file (`authority.ts`, ADR-020, INV-014), a
best-effort extractor (`extractors/work_intelligence.ts`) and the byte-preserving
frontmatter patcher (`frontmatter_patch.ts`, INV-022) — so no shared lexer module is
introduced, but all four now apply one rule: a quote character opens a quoted scalar
only where a scalar or flow-list item begins, `''` escapes a quote inside single
quotes, and a backslash escapes the next character inside double quotes. A mid-word
apostrophe (`it's`, `maintainer's-v4`) therefore no longer hides a trailing
`# comment`. In addition:

- `parseAuthorityYaml` refuses, with the existing `META_AUTHORITY_CONFIG_INVALID`, plain
  `null`/`~`/`true`/`false` tokens (in any YAML core-schema spelling), a key not followed
  by a space or the end of the line (`schema:l9.meta-authority/v1`), a plain value
  containing `: ` or ending in `:`, and a block-list key with no items (YAML reads it as
  null; an empty list is written `[]`). Quoted, those values remain ordinary strings.
- The work-intelligence and document-structure extractors drop an unquoted
  `# comment` from a frontmatter scalar and skip a block-scalar header (`|`, `>`, with
  indentation/chomping indicators) instead of asserting it as a value. Their version
  stays `1.1.0`: the remediation's earlier extractor changes (RC-094/095/096/099)
  already moved both to `1.1.0`, unreleased, and this change ships in the same version.
- **DEC-RC-024: Option B** (alternatives: A fix only the three audited lexers, leaving
  the patcher reading the same bytes differently; B also fix the frontmatter patcher's
  `splitInlineComment` with byte-preservation tests; C record the patcher divergence
  and defer). The patcher adopts the same quote-at-start rule in a separate commit, so
  every in-repository reader agrees on a frontmatter scalar. A managed key's value
  range now ends before an inline comment, so a managed patch preserves the user's
  comment byte for byte; existing metadata for such files reads without the comment,
  and reconciliation may report a revision once.

## Consequences

- **On-disk carrier bytes.** Files annotated by an earlier version that carry a
  prologue (PHP, XML-family, cookie-bearing Python/Ruby, `@charset` stylesheets,
  Dockerfiles with parser directives) and every `.ql`/`.sass` file are rewritten once on
  the next write-mode run; files without a prologue are byte-identical.
- **Strategy changes visible through `./advanced`.** `resolveStrategy` may return
  `sidecar` for a `.php` template or a one-line XML/`@charset` file; `.sass` changes from
  `block-comment` to `line-comment`; `.ql` changes prefix from `#` to `//`.
  `StrategySpec` gains two optional fields (`prologue`, `legacyCarrier`) and
  `applyCommentInjection` an optional fourth parameter — additive on the experimental
  subpath; public API names are unchanged.
- **content_hash.** Files whose bodies contain sentinel text now hash their full body,
  so their `content_hash` changes once (the previous value excluded deleted bytes).
  Body text already deleted by earlier runs cannot be recovered.
- **Governed path unchanged.** Carrier decisions and the metadata index are identical:
  every affected extension is `central_manifest` under ADR-024, by the same rule.
- **Escaped values (WU-002).** Existing headers and sidecars holding numeric-looking or
  `~` strings, raw `--`/`*/`/`#{`, a lone CR or a line separator are rewritten once on
  the next run (for example `title: 2024` becomes `title: "2024"`); a second run writes
  nothing. A title that already flipped from `~` to `null` cannot be recovered
  automatically. `yamlScalar` gains an optional `forbidden` argument and
  `SerializeYamlOptions` an optional `forbidden` field (additive, `./advanced`).
- **Authority narrowing (WU-017).** A consumer authority file that used plain
  `null`/`~`/bool values, `key:value` without a space, `: ` inside a plain value or an
  empty block list now fails with `META_AUTHORITY_CONFIG_INVALID` (fail closed, no
  mutation, ADR-020); none exists in this repository or its fixtures. Operator schema
  descriptions/defaults with an apostrophe lose the comment text that used to leak into
  them, and extractor assertion sets change only for commented or block-scalar
  frontmatter.
- Regression evidence: `tests/narrow_yaml_lexers.test.ts` (REG-WU-017-*),
  `tests/frontmatter_patch.test.ts` (DEC-RC-024-B),
  `tests/carrier_value_safety.test.ts` (REG-WU-002-*),
  `tests/carrier_position.test.ts` (REG-WU-001-*), including
  legacy byte-0 files for every prologue language and `.ql`/`.sass`, inject∘strip
  identity and idempotent re-runs.
