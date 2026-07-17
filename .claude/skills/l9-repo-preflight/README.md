# L9 Repository Preflight v4.2

Capability-driven repository preflight for ChatGPT, Claude Code, autonomous workflows, and other agents. It classifies repository archetypes, records environment limits, runs evidence-supported Gates 1-20, and never converts unavailable evidence into a pass.

## Governed v4 kernel runtime

V4 loads four supplied kernel contracts before evaluation. Mode routing runs first, validation/error rules wrap execution boundaries, dependency audit extends Gate 15 and binds its `ci_gate_kernel.v1` requirement to Gate 14, and convergence verifies a stable fixed point before the result can claim completion. See `references/kernel-runtime.md`.

Reports expose `execution_mode`, `kernel_runtime`, and `convergence`; none are inferred after the fact.

## Requirements

- Python 3.11+
- Local repository read access for filesystem mode
- Optional Git for worktree evidence
- Optional GitHub MCP bridge for remote or PR evidence
- Optional host-agent or external reasoning provider for Gate 20B
- Optional scanners are detected at runtime and degrade to `not_observed` when absent

## Run

```bash
python scripts/run_preflight.py /path/to/repository \
  --output artifacts/preflight-report.json \
  --artifact-dir artifacts/preflight
```

Connector-limited mode:

```bash
python scripts/run_preflight.py . \
  --mode connector \
  --advertised-capabilities environment.json \
  --output artifacts/preflight-report.json
```

PR mode emits an MCP action request when no callable bridge is exposed:

```bash
python scripts/run_preflight.py . \
  --audit-mode pr \
  --repository owner/repo \
  --pr-number 123 \
  --artifact-dir artifacts/preflight
```

## Validate the skill

```bash
python -m pytest -q
python -m compileall -q scripts
python scripts/validate_exemplary_skill.py .
python scripts/validate_manifest.py manifest.json
```

The canonical implementation is `scripts/preflight/v41.py`. Earlier version modules remain compatibility surfaces covered by regression tests.

## Optional cross-language semantic parsing

Install `python -m pip install -r requirements-tree-sitter.txt` to enable structural JavaScript, TypeScript, and Bash analysis. Python retains native AST depth. Missing grammars degrade honestly to limited parsing.


## Repository Intelligence Plane

V4.1 emits a versioned semantic snapshot, coverage ledger, deterministic local module graph, semantic delta, and JSONL evidence stream. Source bytes remain authoritative; these artifacts are derived evidence projections. Query them with:

```bash
python scripts/query_semantic.py artifacts/preflight/semantic-snapshot.json find-symbols --name handler
```

See `references/repository-intelligence-plane.md`.

## Gate 20B default reasoning

Interactive agent use defaults to the active user-facing host model as the Gate 20B reasoning provider. No separate LLM API key is required. The deterministic first pass emits `gate20-reasoning-request.json`; the host agent must answer that request and rerun with `--reasoning-response`.

```bash
python scripts/run_preflight.py . --artifact-dir artifacts/preflight
# Host agent creates artifacts/preflight/gate20-reasoning-response.json
python scripts/run_preflight.py . \
  --reasoning-response artifacts/preflight/gate20-reasoning-response.json \
  --artifact-dir artifacts/preflight
```

Autonomous CI is detected from `CI=true` or `GITHUB_ACTIONS=true` and defaults to static Gate 20A. `--autonomous` forces that behavior explicitly. External model credentials remain optional.
