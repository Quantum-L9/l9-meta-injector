# Provider Credentials

The skill requires no bundled credentials.

Live provider credentials depend on the host:

- ChatGPT GitHub connector: user-authorized connector session; no token is passed to the skill.
- Claude Code GitHub MCP server: credentials configured in the MCP server environment, commonly a GitHub App token or fine-grained PAT with only the required repository permissions.
- Other agents: inject a provider executor backed by their own credential store.
- LLM reasoning provider: host model session or an API key stored outside the skill and exposed only to the provider process.

Minimum GitHub permissions are read-only for analysis. PR mode may additionally require pull-request metadata and checks access. Writes require contents/pull-requests permissions only when explicitly requested.

Never place tokens, API keys, private keys, or connector receipts containing secrets in the pack or generated reports.
