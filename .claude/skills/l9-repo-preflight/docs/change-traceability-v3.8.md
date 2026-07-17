# v3.8 Change Traceability

| Confirmed defect | Corrective action | Proof |
|---|---|---|
| Optional scanners detected twice | Environment consumes shared tool registry | `test_tool_detection_is_reused_by_environment` |
| Writable filesystem conflated with authorization | Added `write_observable` and `write_authorized` | `test_write_observable_is_not_write_authorized` |
| `full` mode fabricated host availability | Provider resolution now requires advertised capability | `test_full_mode_without_advertised_provider_falls_back_static` |
| Reasoning response validation was shallow | Validate required fields, confidence, IDs, and de-escalation | `test_invalid_reasoning_response_missing_fields_is_rejected` |
| Gate crash lacked canonical finding | Emit `G<id>-INTERNAL-ERROR` finding | `test_gate_crash_emits_canonical_finding` |
| PyYAML package identity was ambiguous | Record distribution and import names | `test_runtime_dependency_uses_distribution_and_import_names` |
| Current schema lacked strict identity | Added v3.8 report and environment schema validation | `test_v38_schema_accepts_generated_report` |
