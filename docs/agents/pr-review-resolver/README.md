# PR Review Resolver — Reusable Agent Prompt

A single reusable prompt that turns any capable coding agent (Claude Code,
Cursor, GH Actions + LLM, or an L9 sidecar agent) into an autonomous PR
review resolver.

## What it does
Reads review-agent + human comments on open PRs, validates each suggestion,
implements the accepted fixes, and pushes focused commits to each PR.

## Files
- PR_REVIEW_RESOLVER_AGENT.md  — the agent prompt (inject inputs, run)
- inputs.example.yaml          — fill-in-the-blanks input block
- README.md                    — this file

## Use
1. Copy inputs.example.yaml -> inputs.yaml and fill values.
2. Paste PR_REVIEW_RESOLVER_AGENT.md as the system/agent prompt.
3. Provide inputs.yaml values (or inline the {{TOKENS}}).
4. Run. The agent executes the full discover -> validate -> fix -> push loop.

## Required token scopes
repo: contents:write, pull_requests:write
