<!-- L9_META
l9_schema: 1
parent: l9-pr-remediation
layer: reference
role: signal_ingestion
tags: [pr, ci, review, ingestion, github-api, gate-discovery]
owner: igor_beylin
status: active
version: 2.0.0
updated: 2026-06-18
/L9_META -->

# Signal Ingestion

## Purpose

Fetch all actionable signals from an open PR: CI gate failures, code review comments, and workflow definitions. Normalize them into a unified finding list for classification.

## Gate Discovery (FIRST — before CI log ingestion)

### Step 0: Parse workflow YAML

```bash
# List all workflow files
find .github/workflows -name "*.yml" -o -name "*.yaml"

# Read each one — extract job names and run commands
cat .github/workflows/*.yml
```

For each workflow file, extract:
- **Job names** and their `runs-on` value
- **Step names** and their `run:` commands
- **Conditions** (`if:` clauses that might skip steps)
- **Environment variables** required (`env:` blocks)

Build the **gate registry**:

```yaml
ci_gates:
  - gate: "type-check"
    command: "npx tsc --noEmit"
    workflow: "build-and-validate.yml"
    job: "validate"
    step: "Type check"
    can_run_locally: true
  - gate: "pipeline-dry"
    command: "npm run pipeline:dry"
    workflow: "build-and-validate.yml"
    job: "validate"
    step: "Run pipeline dry"
    can_run_locally: true
  - gate: "verify-env"
    command: "node scripts/verify-launch-env.mjs --ci"
    workflow: "build-and-validate.yml"
    job: "validate"
    step: "Verify launch env"
    can_run_locally: true
    note: "May warn on missing secrets — check if --ci flag handles this"
```

Also check `package.json` scripts for additional gates:
```bash
cat package.json | grep -A1 '"scripts"'
```

This gate registry is used by the fix-engine for local verification.

## CI Signal Ingestion

### Step 1: Get latest CI run

```bash
gh run list --branch {branch} --limit 3 --json databaseId,status,conclusion,event
```

Pick the most recent run with `conclusion != success`.

### Step 2: Get failed job logs

```bash
gh run view {RUN_ID} --log-failed
```

If output is too large, get job-level summary first:

```bash
gh run view {RUN_ID} --json jobs --jq '.jobs[] | select(.conclusion == "failure") | {name, conclusion}'
```

Then fetch per-job:

```bash
gh run view {RUN_ID} --log --job-id {JOB_ID} 2>&1 | tail -100
```

### Step 3: Parse CI failures

Extract from logs:
- **Gate name**: the job/step that failed (match against gate registry from Step 0)
- **Error message**: the actual error output
- **File + line**: when available (lint errors, type errors, test failures)
- **Command**: the exact command the CI ran (from gate registry)

## Review Comment Ingestion

### Step 1: Get PR reviews

```bash
gh api /repos/{owner}/{repo}/pulls/{pr_number}/reviews --jq '.[] | {id, user: .user.login, state, body}'
```

Filter for `state: "CHANGES_REQUESTED"` or `state: "COMMENTED"` with actionable body.

### Step 2: Get inline (diff) comments

```bash
gh api /repos/{owner}/{repo}/pulls/{pr_number}/comments --jq '.[] | {id, user: .user.login, path, line, body, created_at}'
```

### Step 3: Get general PR comments (non-inline)

```bash
gh pr view {pr_number} --repo {owner}/{repo} --comments --json comments --jq '.comments[] | {author: .author.login, body, createdAt}'
```

### Step 4: Filter resolved threads

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100) {
          nodes {
            isResolved
            comments(first: 5) {
              nodes { body author { login } path line }
            }
          }
        }
      }
    }
  }
' -f owner={owner} -f repo={repo} -F pr={pr_number}
```

Only process threads where `isResolved: false`.

## Unified Finding Format

Normalize all signals into:

```yaml
findings:
  - id: "ci-1"
    source: ci | review_inline | review_general
    author: "github-actions" | "gemini-code-assist" | "coderabbitai" | "{human}"
    severity: blocking | actionable | discussion | deferred
    file: "src/index.ts"  # null for general comments
    line: 42              # null for general comments
    message: "Type error: Property 'foo' does not exist on type 'Bar'"
    gate: "type-check"    # null for review comments
    local_verify_command: "npx tsc --noEmit"  # from gate registry
    raw: "full original text"
```

## Bot Detection

Identify review bots by login:
- `gemini-code-assist[bot]` → Gemini
- `coderabbitai[bot]` → CodeRabbit
- `github-actions[bot]` → CI (should already be in CI signals)
- `copilot[bot]` → GitHub Copilot
- All others → human reviewer

## Deduplication

When a review comment references the same file+line as a CI error, merge into one finding. Prefer the CI error message (more precise) but retain the review comment's suggested fix if present.

## Ingestion Completeness Check

After ingestion, verify:
- [ ] All workflow files read and gates registered
- [ ] All CI failures mapped to a gate in the registry
- [ ] All unresolved review threads captured
- [ ] All inline suggestions captured with file+line
- [ ] Bot vs human attribution correct
- [ ] Duplicates merged
