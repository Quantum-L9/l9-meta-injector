<!-- L9_META
l9_schema: 1
parent: l9-plan
origin: migrated-from spec command v7.1.0
tags: [spec, specification, architecture, acceptance]
status: active
/L9_META -->

# Spec Workflow — Specification Generator

Generate complete spec before implementation.

## Gather context

```text
QUESTIONS:
├── What problem does this solve?
├── Who are the users?
├── What are the constraints?
├── What already exists to leverage?
└── What does success look like?
```

## Spec sections

1. Overview — problem, solution, success criteria
2. Constraints — must / must not / should
3. Architecture — diagram
4. Components — table
5. Data flow
6. Operations — deploy, monitor, rollback
7. Risks
8. Acceptance criteria (checkboxes)
9. Phases — scope and GMP count

## Output location

```text
specs/{project}-spec.md
```

## Future: IR engine integration

When wired, `SemanticCompiler` / `UnifiedController.compile_only()` can pre-populate constraints from NL during gather context. **Status:** not yet wired — manual gather only.

Auto-chain recommendation: load `l9-ynp` (recommends forge or gmp).
