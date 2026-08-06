# L9 Node.js and TypeScript compatibility add-on

Adds deterministic Node/TypeScript profiling, providers, language-neutral findings, validator resolution, and follow-up verification.

```bash
PYTHONPATH=. python3 -m l9_node_ts.cli
l9-node-audit /path/to/repo --output findings.node.json
l9-node-validator /path/to/repo --output validator-plan.json
```

The Auditor owns ecosystem detection and provider execution. The Planner consumes only language-neutral findings and validator contracts. The Remediator executes approved executable/argument vectors without a shell. Expected binary assets remain `supported_binary` and do not make an audit partial.
