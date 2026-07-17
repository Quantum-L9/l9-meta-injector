# Defect-to-Fix Traceability

| Defect | Implemented control | Evidence |
|---|---|---|
| Fixed foundations | Capability discovery and archetype gates | `probe/capability_detector.py`, `gates/archetype/` |
| Single repo type | Multi-archetype weighted profile | `probe/repository_profiler.py` |
| Binary verdicts | Eight-state gate model | `gates/model.py` |
| Connector overclaim | Execution context plus `full_preflight` | `probe/execution_context.py`, `v31.py` |
| Regex-only suppression | Candidate/context/policy classifier | `semantic/shell_command_classifier.py`, `suppression_analyzer.py` |
| Advisory mode missed | Enforcement coverage analyzer | `semantic/enforcement_coverage.py` |
| Unsafe action autofix | Dynamic-path detection and closed registry | `semantic/action_reference_analyzer.py`, `remediation/registry.py` |
| Docs/runtime contradiction missed | Contradiction detector | `probe/contradiction_detector.py` |
