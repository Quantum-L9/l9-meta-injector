<!-- L9_META
l9_schema: 1
parent: l9-pr-remediation
layer: reference
role: fix_engine
tags: [pr, fix, code, methodology, local-verify, batch]
owner: igor_beylin
status: active
version: 2.0.0
updated: 2026-06-18
/L9_META -->

# Fix Engine

## Purpose

Apply fixes for classified findings. Each fix type has a specific methodology to minimize regression risk and maximize first-attempt success. ALL fixes for a cycle are batched, verified locally, and committed as ONE unit.

## Hard Rules

- MUST read the target file before editing.
- MUST understand the surrounding context (imports, types, dependencies).
- MUST NOT change code unrelated to the finding.
- MUST NOT introduce new warnings or errors.
- MUST NOT commit or push until ALL fixes are applied AND local verify passes.
- MUST use the smallest diff that resolves the finding.
- When a fix would require changes outside the PR's file scope, mark as deferred.
- NEVER push partial fixes — all or nothing per cycle.

## Gate Discovery (MANDATORY FIRST STEP)

Before applying any fixes, enumerate ALL CI gates that can fail:

```bash
# Read all workflow files
find .github/workflows -name "*.yml" -o -name "*.yaml" | xargs cat
```

Extract every `run:` command from steps that can produce a non-zero exit. Build the **local verify command list**:

```yaml
local_verify_commands:
  - name: "type-check"
    command: "npx tsc --noEmit"
    source: ".github/workflows/build-and-validate.yml:step:Type check"
  - name: "lint"
    command: "npx eslint . --max-warnings 0"
    source: ".github/workflows/build-and-validate.yml:step:Lint"
  - name: "test"
    command: "npx vitest run"
    source: ".github/workflows/build-and-validate.yml:step:Test"
  - name: "build"
    command: "npm run build"
    source: ".github/workflows/build-and-validate.yml:step:Build"
  - name: "pipeline-dry"
    command: "npm run pipeline:dry"
    source: ".github/workflows/build-and-validate.yml:step:Pipeline dry run"
  - name: "validate"
    command: "node scripts/verify-launch-env.mjs --ci"
    source: ".github/workflows/build-and-validate.yml:step:Verify env"
```

Also check:
- `package.json` scripts section for `lint`, `typecheck`, `test`, `build`, `validate`
- `Makefile` for `pr-check` or `ci` targets
- Any `pre-commit` hooks in `.husky/` or `.git/hooks/`

## Fix Strategies by Type

### Lint Fixes

```bash
# Try auto-fix first
npx eslint --fix {file}        # JS/TS
ruff check --fix {file}         # Python
npx biome check --apply {file}  # Biome
```

If auto-fix fails, read the rule documentation and apply manually.

### Format Fixes

```bash
npx prettier --write {file}
ruff format {file}
```

Format fixes are always safe — apply without further analysis.

### Type-Check Fixes

1. Read the exact error: file, line, expected type vs actual type.
2. Check the type definition source (interface, type alias, imported type).
3. Apply the minimal fix:
   - Missing property → add it with correct type.
   - Wrong type → cast, narrow, or fix the source value.
   - Missing import → add the import.
   - Optional vs required mismatch → add `?` or provide default.
4. NEVER use `any` or `@ts-ignore` as a fix.

### Test Fixes

Priority order:
1. Fix the code under test (if the test caught a real bug).
2. Fix the test assertion (if the test expectation is wrong due to intentional code change).
3. Fix test setup/fixtures (if the test environment is stale).

NEVER delete a failing test unless the feature it tests was intentionally removed in the PR.

### Build Fixes

1. Missing module → add import or install dependency.
2. Syntax error → fix the syntax.
3. Circular dependency → restructure imports.
4. Missing file → check if it should exist (was it deleted accidentally?).

### Security Fixes

1. Dependency vulnerability → update to patched version.
2. Code vulnerability → apply the suggested remediation.
3. NEVER suppress a security finding without explicit user approval.

### Review Comment Fixes

1. **Suggestion block**: Apply the exact suggestion if it's correct.
2. **Bug report**: Read the code, confirm the bug, apply minimal fix.
3. **Property/name correction**: Verify against type definitions, then rename.
4. **Missing null check**: Add the guard.
5. **Performance suggestion**: Apply only if clearly correct and low-risk.

## Local Verification Protocol (BLOCKING GATE)

After applying ALL fixes for a cycle, run EVERY command from the local verify command list:

```bash
# Run ALL gates — do NOT stop at first failure
npx tsc --noEmit
npx eslint . --max-warnings 0
npx vitest run
npm run build
npm run pipeline:dry
node scripts/verify-launch-env.mjs --ci
# ... every other gate discovered in Gate Discovery
```

### Verification Rules

1. **Run ALL gates**, not just the one that was failing. A fix for one gate can break another.
2. **If ANY gate fails** → fix it immediately, then re-run ALL gates from scratch.
3. **Repeat until ALL gates pass.** Only then proceed to commit.
4. **If a fix for gate A breaks gate B** → the fix is wrong. Revert and find a better fix.
5. **If stuck in a loop** (fix A breaks B, fix B breaks A) → mark both as deferred with reason "circular regression".
6. **Maximum local verify iterations**: 5. If not green after 5 attempts, defer the problematic findings.

### What "locally" means

- Run the exact same command CI runs (from workflow YAML `run:` field).
- Use the same Node/Python version if possible.
- If a command requires env vars that are secrets (API keys), check if it has a `--ci` or `--skip-secrets` flag.
- If a command requires external services (database, API), check if it has a dry-run or mock mode.

## Batch Discipline

```text
┌─────────────────────────────────────────────────────────┐
│  WITHIN A SINGLE CYCLE:                                  │
│                                                          │
│  1. Apply fix for finding-1                              │
│  2. Apply fix for finding-2                              │
│  3. Apply fix for finding-N                              │
│  4. Run ALL local verify gates                           │
│  5. Fix any new failures from step 4                     │
│  6. Re-run ALL local verify gates                        │
│  7. Repeat 5-6 until green                               │
│  8. git add -A && git commit (ONE commit)                │
│  9. git push (ONE push)                                  │
│                                                          │
│  ❌ NEVER: commit after each fix                         │
│  ❌ NEVER: push without local verify green               │
│  ❌ NEVER: push multiple times per cycle                 │
└─────────────────────────────────────────────────────────┘
```

## Commit Convention

Each remediation cycle produces exactly ONE commit:

```
fix(pr-remediation): cycle {N} — resolve {count} findings

Fixes:
- {finding-id}: {one-line description}
- {finding-id}: {one-line description}

Local verify: all {N} gates passed
Deferred:
- {finding-id}: {reason}
```

## Rollback Protocol

If a fix introduces a NEW CI failure that didn't exist before:

1. `git diff HEAD~1` — identify the problematic change.
2. Revert only that specific change.
3. Mark the original finding as `deferred` with reason: "fix causes regression".
4. Re-run local verify to confirm revert is clean.
5. Continue with remaining fixes.
6. Report the regression in the convergence block.
