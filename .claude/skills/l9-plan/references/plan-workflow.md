<!-- L9_META
l9_schema: 1
parent: l9-plan
origin: migrated-from plan command v1.0.0
tags: [plan, todo, risks, estimate]
status: active
/L9_META -->

# Plan Workflow — Execution Planning

Create structured plan before implementation.

## Steps

1. Define objective (what, why, success criteria).
2. Identify scope (in / out).
3. List TODO items with files, effort, risk.
4. Map dependencies.
5. Identify risks and mitigations.

## Output format

```markdown
## PLAN: {title}

### Objective
{what and why}

### Scope
**In:** {list}
**Out:** {list}

### TODO Plan
| # | Task | Files | Effort | Risk |
|---|------|-------|--------|------|

### Dependencies
{graph}

### Risks
| Risk | Mitigation |
|------|------------|

### Estimate
**Total:** {time}
**GMPs:** {count}
```

Auto-chain recommendation: load `l9-ynp` (recommends gmp or forge).
