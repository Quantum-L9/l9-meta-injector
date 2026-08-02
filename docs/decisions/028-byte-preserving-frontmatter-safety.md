# ADR-028: Byte-preserving managed frontmatter safety

## Status

Accepted for PR-4 implementation.

## Context

The historical injector parsed a leading YAML block and then serialized the entire
header again. That behavior could reorder keys, discard comments, normalize quoting
and newlines, duplicate ambiguous headers, and overwrite complex user-authored YAML.
The same whole-header rewrite existed in Cursor-native `SKILL.md` handling. The
frontmatter carrier set also included MDX and reStructuredText even though their
leading syntax is not universally an ordinary YAML header.

## Decision

Only `.md` and `.markdown` are ordinary YAML-frontmatter carriers. `.mdx`, `.rst`,
`.txt`, and `.text` are not inline carriers and therefore flow to carrier policy.

Inline mutation uses one narrow managed-field patcher:

1. Opening and closing fences must each be an exact `---` line.
2. BOM and the header's LF or CRLF convention are preserved.
3. The body is retained byte-for-byte.
4. Existing key order, comments, whitespace, quoting, and unrelated fields are not
   reserialized.
5. Only top-level scalar fields and top-level scalar sequences are supported.
6. Duplicate keys, nested maps, block scalars, anchors, aliases, tags, directives,
   mixed header newlines, tabs, duplicate leading blocks, and ambiguous fences fail
   closed without mutation.
7. Managed values replace only their own value spans. Missing managed keys append
   immediately before the closing fence in deterministic input order.
8. Skills mode patches only fields it materially changed. It never rewrites the
   complete Cursor header.

## Consequences

Simple headers remain editable and idempotent without collateral byte churn. Complex
or ambiguous YAML requires a human-authored migration before inline management is
permitted. This deliberately trades broad YAML coverage for preservation and safety.
