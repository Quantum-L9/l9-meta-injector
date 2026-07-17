# AST and Structured Parsing

Use layered analysis:

1. Parse Python with `ast.parse` to identify definitions, calls, decorators, annotations, and migration operations.
2. Parse YAML and JSON structurally for workflows, policies, and manifests.
3. Use regex only to discover candidates in unstructured shell, Markdown, or mixed template text.
4. Extract local context around each candidate.
5. Classify with repository capability, policy, and execution evidence.
6. Route ambiguous or unparsable cases to `requires_human_review` or `not_observed`.

Current AST-backed gates:

- Gate 16: service endpoints and health decorators.
- Gate 17: destructive migration calls and annotated PII fields.
- Gate 19: tool function definitions compared with prompt references.

The AST layer records parse errors and never silently falls back to a clear verdict.
