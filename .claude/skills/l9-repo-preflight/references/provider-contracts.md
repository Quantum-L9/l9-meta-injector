# Provider Contracts

Host-agent reasoning uses a structured request and requires no external API credential. External providers are optional and host-managed. GitHub uses MCP first. Provider resolution occurs before invocation; missing configuration is not discovered by intentional authentication failure. Secret values never enter reports or receipts.
