from __future__ import annotations
# Canonical capability contracts for every numbered gate. Earlier gates retain their
# established semantics while exposing runtime requirements in one machine-readable map.
def contracts()->dict[int,dict]:
 base={i:{'gate_id':i,'required_capabilities':['repository_read'],'optional_capabilities':[],'minimum_evidence':['repository_evidence'],'absence_behavior':'not_observed','degraded_mode':'evidence_limited','execution_mode_constraints':['filesystem','connector']} for i in range(1,21)}
 for i in (1,2,3,4,5,6,7,8): base[i]['optional_capabilities']=['git_state','command_execution']
 for i in range(9,15): base[i]['optional_capabilities']=['structured_parser','command_execution']
 base[15].update(required_capabilities=['repository_read'],optional_capabilities=['dependency_vulnerability_scan','static_analysis','sbom_generation','secret_scan'],minimum_evidence=['dependency_or_supply_chain_surface'])
 base[16].update(optional_capabilities=['python_ast','health_probe_execution'],minimum_evidence=['deployable_service_capability'])
 base[17].update(optional_capabilities=['python_ast','migration_parser'],minimum_evidence=['data_persistence_capability'])
 base[18].update(optional_capabilities=['complexity_analysis','duplicate_code_analysis','import_boundary_analysis'])
 base[19].update(optional_capabilities=['python_ast','prompt_parser'],minimum_evidence=['agent_prompt_capability'])
 base[20].update(required_capabilities=['prior_gate_results'],optional_capabilities=['host_agent_reasoning','external_reasoning_provider','pull_request_evidence'],minimum_evidence=['gates_9_through_19'],degraded_mode='static_only')
 return base
