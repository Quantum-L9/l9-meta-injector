# GitHub MCP-First Provider Contract

## Authority order

1. GitHub MCP connector
2. MCP action request for host execution
3. `gh` CLI only for a proven connector capability gap
4. dry-run intent receipt

## Provider modes

- `dry_run`: no remote effects.
- `mcp_first`: call the injected MCP executor for every supported operation.
- `mcp_action_request`: when the Python runtime has no connector executor, emit a structured request for the hosting agent to execute.
- `cli_gap_fallback`: use `gh` only after MCP returns `unsupported_capability` or `connector_unavailable` and explicit fallback authorization exists.

## Non-bypass failures

CLI MUST NOT bypass MCP responses indicating authentication failure, permission denial, policy rejection, invalid input, rate limiting, provider error, or transient failure. These remain visible blockers or human-review findings.

## Required receipt fields

- `effect`
- `ok`
- `provider`
- `provider_path`
- `dry_run`
- `status` when not successful
- `fallback_reason` when CLI is used
- `mcp_receipt` when CLI follows an MCP capability gap

## Supported provider operations

- ensure labels
- find or open pull requests
- search, create, and update issues
- inspect pull-request checks and review state

## Local git boundary

Local `git` is not a substitute for GitHub MCP. It may handle worktree-native status, staging, deterministic commits, and branch construction. Remote push is permitted only when the active MCP connector cannot perform the equivalent bulk commit/push operation and the fallback is explicitly authorized and evidenced.
