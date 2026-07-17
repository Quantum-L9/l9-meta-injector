# Agent Runtime Contract

1. Read `SKILL.md`, then only the references needed for the requested mode.
2. Run `scripts/run_preflight.py` for deterministic local execution.
3. Advertise host, MCP, GitHub, reasoning, filesystem-write, and Git-write capabilities explicitly.
4. Execute structured MCP or reasoning requests only when authorized; return receipts with provenance.
5. Preserve `not_observed`, limitations, and deterministic findings.
6. Never provide credentials to the skill or claim unexecuted provider work.
7. Validate reports against `schemas/preflight-v3.8-report.schema.json` and validate the manifest before packaging.
