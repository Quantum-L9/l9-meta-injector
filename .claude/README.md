# Claude Code capabilities (installed & active)

This directory holds Claude Code skills and agents that are auto-discovered and
activated for sessions in this repository.

## Skills — `.claude/skills/`

| Skill | Invoke | Purpose |
|-------|--------|---------|
| `l9-pr-remediation` | `/l9-pr-remediation` | Recursive PR improvement loop: ingest CI failures **and** code-review bot comments (Gemini/CodeRabbit/reviewers), apply all fixes, verify every CI gate locally, push one commit per cycle, reply to and resolve every review thread, then wait for CI and loop until converged (max 3 cycles). Full contract + references live in `skills/l9-pr-remediation/`. |

## Agents — `.claude/agents/`

| Agent | Select as | Purpose |
|-------|-----------|---------|
| `pr-review-resolver` | `pr-review-resolver` | Autonomous PR **review-comment** resolver across one or more in-scope PRs: discover → validate each suggestion (rejecting false positives) → apply focused commits → reply/resolve threads → emit a run report. Use `l9-pr-remediation` instead when CI is also failing and you need the full CI + review convergence loop. |

## Sources preserved

The `pr-review-resolver` agent was activated from a reusable agent-prompt
bundle. Its original prompt, README, and the fill-in `inputs.example.yaml`
template are preserved verbatim under
[`docs/agents/pr-review-resolver/`](../docs/agents/pr-review-resolver/).

## Notes

- Both capabilities target GitHub PRs and pair naturally with this repo's
  `.github/workflows/pr-pipeline.yml`, which requests Copilot / GitHub code
  reviews and re-requests review once all threads are resolved.
- These artifacts carry L9 metadata (`l9_schema`, `layer`, `role`, `owner`,
  `status`) and are ready to be indexed by the meta-injection pipeline in this
  repo if desired.
