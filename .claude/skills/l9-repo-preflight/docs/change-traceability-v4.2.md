# V4.2 Claude Code Feedback Traceability

| Feedback | Fix | Proof |
|---|---|---|
| Gate 20B omitted Gates 9-14 and G20 synthesis IDs | Union all surfaced findings and deterministic synthesis findings into request and validation allowlists | `test_gate20_reasoning_can_cite_semantic_and_synthesis_findings` |
| Successful reasoning retained a stale request receipt | Replace request receipt with validated completion receipt and response digest | `test_reasoning_receipt_is_completed_after_valid_response` |
| CLI could not complete the two-pass host-agent flow | Add `--reasoning-response`; persist reasoning response and forensic audit artifacts | `test_cli_accepts_reasoning_response_argument` |
| Semantic action findings had no gate ownership | Assign Gate 14 identity and CI domain | `test_semantic_action_findings_have_gate_14` |
| Gate 20B was not enabled by default for user-facing agents | Interactive default advertises the host agent; autonomous CI defaults static | `test_interactive_default_enables_host_agent_and_autonomous_defaults_static` |
| Response schema was under-specified | Add item schemas and validator checks for conclusions/actions/references | schema meta-validation and test suite |
