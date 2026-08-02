# ADR-026: Check and apply consume one carrier-aware plan

- **Status:** Accepted
- **Date:** 2026-08-01

## Context

The historical pipeline selected a syntax strategy and immediately treated that
strategy as a write destination. A source file could therefore receive a comment
block or adjacent sidecar even when repository policy required central-manifest
metadata. Check also inferred carriers from the old injection record after the
fact, which allowed planning and mutation to disagree.

## Decision

`src/carrier_operation.ts` is the shared planning boundary for governed `check`
and `apply` operations. It runs the canonical pipeline in non-persisting planning
mode, resolves every metadata subject through `src/mutation_policy.ts`, compiles
`.l9/metadata-index.jsonl`, and exposes only explicitly authorized
`inline_managed` plans for source mutation.

Rules:

1. Check and apply use byte-identical carrier decisions for equivalent inputs.
2. `central_manifest` and `inventory_only` records are materialized only in the
   canonical JSONL index.
3. Historical adjacent-sidecar proposals are ignored and never dispatched.
4. Inline writes require `yaml-frontmatter`, an explicit authority allow rule,
   and a target equal to the source path.
5. Apply rechecks planned target hashes before writing and validates the written
   bytes against the planned hash.
6. Skills discovery recognizes only the canonical `SKILL.md` basename.
7. Full multi-file atomicity remains the responsibility of PR-3.

## Consequences

- The carrier decision is no longer reconstructed from the chosen comment syntax.
- Source, configuration, tests, workflows, and structured data cannot acquire
  adjacent metadata artifacts.
- Check reports drift against the same index and inline targets apply would use.
- Apply remains deliberately non-transactional across multiple files until the
  transactional change-plan workstream lands.
