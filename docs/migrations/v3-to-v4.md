# Migration from 3.x to 4.0.0

Version 4 replaces format-driven mutation with governed carrier policy.

## Required consumer changes

1. Pin the exact 40-character release commit. Do not consume `main`, a branch, or a mutable tag in automation.
2. Add `.l9/meta-authority.yaml` with the canonical writer repository and pinned commit.
3. Remove or disable every competing metadata injector, verifier, hook, workflow, and generator.
4. Default ordinary source, configuration, infrastructure, and structured files to `central_manifest`.
5. Grant `inline_managed` only to explicitly allowed plain-Markdown artifact paths.
6. Run one governed apply to create `.l9/metadata-index.jsonl`, then run check as the recurring CI gate.

## Behavioral changes

- Check performs no repository writes.
- Apply commits the complete carrier set transactionally or restores the original bytes.
- Adjacent `.l9meta.yaml` sidecars and `.inject.log` files are not normal outputs.
- `.mdx`, `.rst`, `.txt`, and `.text` are not automatic YAML-frontmatter carriers.
- Unsafe or complex frontmatter is reported and left byte-identical.

## l9-deploy

The PR-5 migration pack replaces `scripts/inject-l9-meta.py` and `scripts/verify-l9-meta.py` with an immutable-SHA wrapper and a direct pinned GitHub Action check. Existing inline `L9_META` blocks may remain as historical content; they no longer constitute writer authority once all active legacy writer surfaces are removed.
