# Gate 20 Operating Modes

Gate 20A always performs deterministic forensic synthesis. Gate 20B optionally enriches interpretation through a host-agent or external provider. Gate 20C optionally adds verified PR context. Reasoning may escalate, explain, challenge, and prioritize; it may not create evidence, clear blockers, convert `not_observed` to `clear`, or bypass policy.

`auto` resolves host agent, then authorized external provider, then static-only. Static fallback is reduced depth, not failure.
