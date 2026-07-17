# Migration notes — l9-repo-preflight through v3.3

## What changed

v2.1.0 adds a **delivery, accounting & reporting layer** on top of the fail-open
remediation loop, and hardens blocker accounting. The eight-gate engine, the
safe-autofix allow-list, dry-run safety, and ecosystem neutrality are unchanged.

### New behavior

- **Failed autofix → unresolved blocker.** `scripts/preflight/accounting.py` reconciles
  every attempted autofix; a failed *applicable* fix (incl. missing token, missing
  permission, inaccessible private dependency, npm/pip 401) is counted as an
  unresolved blocker. A report never claims zero blockers when a repair failed.
- **Autofix PR delivery** (`--deliver`): intended changes → `preflight/autofix-<run-id>`
  branch → commit → push → PR against `main`. Idempotent; never pushes to `main`.
- **Unresolved-blocker issues** (`--issues`): dedupe/create/update/reopen, sanitized.
- **PR monitoring**: bounded (≤5) deterministic repairs; terminal states; escalation.
- **Technical-debt detection**: evidence-based findings in the reports.
- **Report persistence**: six deterministic, redacted outputs under `docs/preflight/`.
- **Reusable-CI changeover** (`--ci-migration`): a **separate** `ci/adopt-l9-ci-core-<run-id>`
  branch + PR generating the thin l9-ci-core caller (exact-SHA pin, `secrets: inherit`).

### New CLI flags on `scripts/remediate.py`

`--deliver` · `--issues` · `--ci-migration` · `--repo-slug owner/name` · `--allow-cli-fallback`
· `--base main`. Remote effects are MCP-first. `--allow-cli-fallback` permits `gh` only for proven MCP capability gaps and is
skipped entirely under `--dry-run`.

## Provider adapter

All GitHub effects go through `scripts/preflight/github.py`:
- `DryRunAdapter` (default) — records intents, performs no remote effect.
- `GitHubMcpAdapter` — primary provider or structured host action request.
- `McpFirstAdapter` — enforces MCP-first routing and non-bypass rules.
- `GhCliAdapter` — gap-only fallback with explicit authorization and provenance.

To integrate a host MCP runtime, inject an executor into `GitHubMcpAdapter`. Without one, preserve and execute the structured `mcp_action_required` request through the connected GitHub tool.

## Consumer usage (any repo)

```bash
# safe preview: reports only, no mutation, no remote effects
python3 scripts/remediate.py /path/to/repo --dry-run

# apply autofixes + persist reports + open an autofix PR + sync issues
python3 scripts/remediate.py /path/to/repo \
    --deliver --issues --repo-slug OWNER/NAME --allow-cli-fallback --base main

# adopt the canonical CI as a separate PR
python3 scripts/remediate.py /path/to/repo \
    --ci-migration --repo-slug OWNER/NAME --allow-cli-fallback
```

No consumer repository name is hardcoded; `main` is the canonical base branch;
the only fixed reference is the canonical l9-ci-core reusable workflow (by design).

## Idempotency

Re-running is safe: the autofix branch is keyed on `base_sha + change set`, issues on
`repo + blocker_type + artifact + normalized_failure`, and the CI PR on
`repo + reusable_ref + target_path`. Equivalent effects are reused, not duplicated.
