# Validation

## Executed checks

- `pytest -q`: 129 passed.
- `python -m compileall -q scripts`: passed.
- Draft 2020-12 schema meta-validation: 21 schemas passed, including the stricter Gate 20B response schema and v4.2 report schema.
- Portable CLI smoke: report and Gate 20 artifacts emitted. Exit code was `1` because the skill repository itself produced blocker findings; artifact generation and schema identity checks passed.
- Gate 20B complete-finding synthesis regression: passed.
- Gate 20B validated receipt completion regression: passed.
- Interactive host-agent default and autonomous static fallback regressions: passed.
- Semantic Gate 14 ownership regression: passed.
- CLI `--reasoning-response` contract regression: passed.
- Exemplary skill validation: passed.
- SHA-256 manifest: generated and validated before packaging.

## Honest limits

- The active host agent must perform the reasoning callback and rerun the second pass; standalone Python cannot directly invoke ChatGPT or Claude's internal model session.
- Autonomous CI remains deterministic/static unless an external provider is explicitly configured.
- No live GitHub write or external LLM API execution was performed.
