---
name: l9-repo-preflight
description: Perform governed, capability-driven repository preflight with multi-archetype classification, native AST, Tree-sitter, and structured parsing, evidence-aware Gates 1-20, semantic CI analysis, security, reliability, data safety, quality, prompt-tool validation, deterministic forensic synthesis, optional host-agent reasoning, MCP-first GitHub evidence, and honest execution limits. Use when evaluating repository readiness, integrity, CI truthfulness, packaging expectations, workflow safety, security posture, or connector-limited evidence across ChatGPT, Claude Code, or other agents.
---
# L9 Repository Preflight v4.2

Use `scripts/preflight/v41.py` as the canonical control plane or run `python scripts/run_preflight.py <repo>`.

1. Load and validate governed kernel contracts; halt on unresolved fail-closed bindings.
2. Route execution mode from evidence source, host capability, autonomy, remediation authorization, and packaging intent.
3. Detect environment and host capabilities once. Separate observable capability from authorization.
4. Collect filesystem or connector evidence and record completeness limits.
5. Build one versioned semantic snapshot with stable fact IDs, snapshot lineage, parser authority, and coverage before classification.
6. Infer multiple repository archetypes and capabilities without forcing one repository type.
7. Detect contradictions across documentation, structure, workflows, packaging, tests, and release configuration.
8. Apply universal and archetype gates supported by evidence.
9. Run semantic Gates 9-14; use structured parsing or AST where available and regex only for candidate discovery.
10. Activate Gates 15-19 through the unified gate registry using repository capability, policy, evidence, and tool availability.
11. Run Gate 20A deterministic synthesis on every run.
12. Resolve optional Gate 20B reasoning from advertised host capabilities before invocation. Fall back to static mode without probing credentials.
13. Run Gate 20C only with verified PR evidence. Preserve deterministic findings when providers are absent, invalid, stale, denied, or fail.
14. Use GitHub MCP first. Permit CLI only for an explicit MCP capability gap and explicit authorization.
15. Emit `not_observed` for unavailable evidence. Never translate missing evidence into PASS or failure.
16. Emit canonical findings with confidence, provenance, evidence state, false-positive risk, and remediation.
17. Run deterministic fixed-point convergence over the completed report; block full-preflight claims when convergence fails.
18. Generate and validate the final SHA-256 manifest before packaging.

## Portable agent use

- ChatGPT: use connected GitHub MCP tools and the active host model through structured provider boundaries.
- Claude Code: follow `CLAUDE.md`; execute local checks directly and use configured MCP servers for remote evidence.
- Other agents: follow `AGENTS.md` and inject provider executors or process structured action requests.
- Autonomous workflows: deterministic Gate 20 remains complete without an LLM; emit reasoning handoff artifacts with `--artifact-dir`.
- Never bundle credentials. See `references/provider-credentials.md`.

See `README.md`, `references/kernel-runtime.md`, `references/enforcement-gates.md`, `references/environment-requirements.md`, `references/gate20-operating-modes.md`, `references/ast-analysis.md`, `references/audit-policy.yaml`, `CHANGE_SUMMARY.md`, `VALIDATION.md`, and `schemas/preflight-v4.2-report.schema.json`.

## Governance compatibility

Preserve `extract_expertise` and `compress_expertise` evidence disciplines. Maintain `skill_intelligence_report` compatibility and execute applicable `exemplary_gate` checks through `scripts/validate_exemplary_skill.py`. Do not weaken v4 capability, parser, provider, or evidence rules.

## Repository intelligence substrate

Install `requirements-tree-sitter.txt` for structural JavaScript, TypeScript, and Bash analysis. Build the semantic snapshot once per run, derive a deterministic local module graph, and reuse both across profiling, capability routing, gates, forensic synthesis, and downstream agents. Emit snapshot, coverage, graph, delta, and JSONL evidence artifacts. Treat missing grammars, parse errors, and unresolved edges as explicit limitations. See `references/repository-intelligence-plane.md` and `references/tree-sitter-semantic-index.md`.

## Gate 20B host reasoning loop

For interactive ChatGPT, Claude Code, or another user-facing agent session, treat the active agent as the default Gate 20B reasoning provider. Run deterministic preflight, read `gate20-reasoning-request.json`, produce a schema-valid response grounded only in the listed finding IDs, and rerun with `--reasoning-response`. Do not stop after emitting the request when the host can reason and execute the second pass.

For autonomous CI, preserve static fallback. Never require an external LLM key unless the workflow explicitly configures an external provider.
