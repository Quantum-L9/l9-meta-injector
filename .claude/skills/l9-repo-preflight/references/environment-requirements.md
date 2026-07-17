# Environment Requirements

The deterministic engine requires Python 3.11+ and repository read access. Runtime packages are distinct from development tools, optional scanners, host capabilities, and external providers. The environment detector runs once per preflight and emits `environment-capability-report.json` without probing secret values.

- Runtime: Python, PyYAML, jsonschema, standard-library TOML where available.
- Development: pytest, lint and type-check tools.
- Optional scanners: pip-audit, bandit, semgrep, syft, actionlint, radon, jscpd, import-linter, detect-secrets.
- Filesystem: reads are required; writes, temporary files, and archive creation are separate capabilities.
- Git: optional for static scanning; required for authoritative worktree state, diffs, and local commits.
- Network: not required for local deterministic mode. Remote repository evidence, live vulnerability data, action resolution, and external reasoning require network capability.
- Host runtime: MCP and model access belong to the host. Their availability does not imply a Python subprocess can invoke them.
