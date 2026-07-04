---
name: l9-plan
description: create an execution plan or implementation specification before building. use when scope is unclear, requirements need decomposition, or the next step should be planned before code changes.
skill_schema: 1
layer: control_plane
role: skill_entrypoint
tags: [l9, plan, spec, execution, requirements]
owner: igor_beylin
status: active
version: 2.0.0
updated: 2026-06-06
---

# Execution Planning

## Purpose

Produce a structured plan or full specification before implementation. Planning-only — no code edits unless the user explicitly chains to `l9-gmp-protocol` or another execution skill.

## Core Contract

| Mode | Output | Load |
|------|--------|------|
| plan | TODO plan, risks, estimate | [references/plan-workflow.md](references/plan-workflow.md) |
| spec | Full spec document for forge/gmp | [references/spec-workflow.md](references/spec-workflow.md) |
| ticket | Engineering ticket structure | [references/engineering-ticket-template.md](references/engineering-ticket-template.md) |

## Authority Order

1. Explicit user objective and constraints.
2. Verified repo ground truth — existing modules, patterns, ADRs.
3. Repo invariants — `AGENTS.md`, `.cursor/rules/*.mdc`.
4. This skill's references.
5. `Unknown` — ask before filling gaps in the spec.

## Compact Workflow

1. **Gather** — objective, scope in/out, success criteria.
2. **Decompose** — TODO table with files, effort, risk.
3. **Dependencies** — task graph; identify blockers.
4. **Deliver** — plan markdown or `specs/{project}-spec.md` per mode.
5. **Recommend** — load `l9-ynp` for gmp vs forge vs continue.

## Resource Map

- [references/plan-workflow.md](references/plan-workflow.md) — execution plan output format.
- [references/spec-workflow.md](references/spec-workflow.md) — full specification generator.
- [references/engineering-ticket-template.md](references/engineering-ticket-template.md) — acceptance criteria, GWT scenarios.

## Validation

Every TODO MUST name files or `TBD` with a blocker note. Scope out MUST be explicit. No placeholder "TODO: fill in" without a question to the user.

## Failure Handling

- Ambiguous objective → STOP at gather; ask clarifying questions.
- Scope creep detected → move items to Out of scope.
- Protected-path changes planned → flag KERNEL GMP requirement.
- User requests immediate implementation → recommend `l9-gmp-protocol`; do not edit files in plan mode.
