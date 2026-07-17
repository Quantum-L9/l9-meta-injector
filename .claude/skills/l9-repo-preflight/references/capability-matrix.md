# Capability Matrix

Every gate declares required and optional capabilities in `scripts/preflight/gate_capabilities.py`. Missing required execution capability yields `not_observed`; missing optional capability reduces depth or confidence. Unsupported provider operations, permission denial, authentication state, and provider failure are separate states.

GitHub operations are modeled individually: repository read, PR read, checks, workflow runs, branch creation, file updates, PR creation, comments, and check writes. Analysis never requires write permissions.
