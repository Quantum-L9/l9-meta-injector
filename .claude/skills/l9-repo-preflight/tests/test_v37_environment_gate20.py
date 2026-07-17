from __future__ import annotations
import json
from pathlib import Path
import pytest
from preflight.v37 import run
from preflight.environment.detector import detect_environment, stable_fingerprint
from preflight.gate_capabilities import contracts
from preflight.providers.reasoning import AuditResponse

class FakeReasoner:
 def analyze(self,request):
  return AuditResponse('ok',[],'fake',{'provider_type':'external_provider','provider_identity':'fake','model_identity':'fake-1','prompt_contract_version':'1.0','evidence_digest':request.evidence_digest,'response_digest':'abc','generated_at':'2026-01-01T00:00:00Z','reproducible':False,'cached':False,'redaction_applied':True,'validation_status':'pending'})

def advertised(host=False,external=False):
 return {'reasoning_provider':{'host_agent_session':host,'external_provider_configured':external,'credentials_available':True if external else False},'mcp_bridge':{'state':'direct_host_tool_execution' if host else 'unavailable','python_subprocess_access':False,'supported_operations':['read_repository'] if host else []},'github_provider':{'authentication_state':'host_managed' if host else 'unknown','operations':{'read_repository':'supported' if host else 'unsupported'}}}

def test_environment_attached_to_every_report(tmp_path):
 r=run(tmp_path,audit_mode='static_only')
 assert r['environment_capability_report']['schema_version']=='1.0'
 assert r['preflight_result']['environment_capability_report_ref']=='environment-capability-report.json'

def test_python_version_and_dependency_classification(tmp_path):
 e=detect_environment(tmp_path)
 p=e['execution_environment']['python']
 assert p['available'] and p['minimum_supported_version']=='3.11'
 assert 'yaml' in p['runtime_dependencies'] and 'pytest' in p['development_dependencies']
 assert 'semgrep' in p['optional_dependencies']

def test_read_only_connector_cannot_claim_write(tmp_path):
 e=detect_environment(tmp_path,'connector')
 assert e['execution_environment']['filesystem']['write'] is False
 assert 'filesystem_write_unavailable' in e['capability_limitations']

def test_git_absence_or_nonrepo_is_honest(tmp_path):
 e=detect_environment(tmp_path)
 assert e['execution_environment']['git']['repository_detected'] is False
 assert e['execution_environment']['git']['dirty_tree_observable'] is False

def test_mcp_host_does_not_imply_subprocess_access(tmp_path):
 e=detect_environment(tmp_path,advertised=advertised(host=True))
 assert e['execution_environment']['mcp_bridge']['state']=='direct_host_tool_execution'
 assert e['execution_environment']['mcp_bridge']['python_subprocess_access'] is False

def test_github_matrix_distinguishes_operation_support(tmp_path):
 e=detect_environment(tmp_path,advertised=advertised(host=True))
 assert e['execution_environment']['github_provider']['operations']['read_repository']=='supported'
 assert e['execution_environment']['github_provider']['authentication_state']=='host_managed'

def test_optional_scanner_absence_has_not_observed_semantics(tmp_path,monkeypatch):
 monkeypatch.setattr('shutil.which',lambda _:None)
 e=detect_environment(tmp_path)
 assert e['execution_environment']['python']['optional_dependencies']['semgrep']['absence_behavior']=='not_observed'

def test_parser_limitations_are_reported(tmp_path):
 e=detect_environment(tmp_path)
 assert e['execution_environment']['parsers']['python_ast']['support']=='native'
 assert e['execution_environment']['parsers']['typescript']['support']=='limited'

def test_offline_network_is_not_probed(tmp_path):
 e=detect_environment(tmp_path)
 assert e['execution_environment']['network']=={'available':'unverified','detection_method':'no_external_probe'}

def test_platform_support_truthful(tmp_path):
 e=detect_environment(tmp_path)
 p=e['execution_environment']['platform']
 assert p['tested_status'] in ('tested','UNVERIFIED')

def test_every_gate_declares_capability_contract():
 c=contracts(); assert set(c)==set(range(1,21))
 required={'gate_id','required_capabilities','optional_capabilities','minimum_evidence','absence_behavior','degraded_mode','execution_mode_constraints'}
 assert all(required<=set(v) for v in c.values())

def test_environment_fingerprint_ignores_timestamp(tmp_path):
 a=detect_environment(tmp_path); b=json.loads(json.dumps(a)); b['generated_at']='later'
 assert stable_fingerprint(a)==stable_fingerprint(b)

def test_gate20_auto_prefers_host_agent(tmp_path):
 r=run(tmp_path,audit_mode='auto',advertised_capabilities=advertised(host=True))
 assert r['forensic_audit']['provider_resolution']['resolved_mode']=='host_agent'
 assert r['forensic_audit']['reasoning']['reason']=='host_action_required'

def test_gate20_auto_uses_external_when_host_absent(tmp_path):
 r=run(tmp_path,audit_mode='auto',advertised_capabilities=advertised(external=True),reasoning_provider=FakeReasoner())
 assert r['forensic_audit']['provider_resolution']['resolved_mode']=='external_provider'

def test_gate20_auto_falls_back_static(tmp_path):
 r=run(tmp_path,audit_mode='auto')
 g=r['forensic_audit']
 assert g['static']['executed'] is True and g['reasoning']['status']=='not_observed'
 assert g['audit_depth']=='deterministic'

def test_missing_llm_does_not_fail_workflow(tmp_path):
 r=run(tmp_path,audit_mode='auto')
 assert r['forensic_audit']['static']['executed'] and r['preflight_result']['audit_depth']=='deterministic'

def test_reasoning_request_uses_digest(tmp_path):
 r=run(tmp_path,audit_mode='auto',advertised_capabilities=advertised(host=True))
 req=r['forensic_audit']['reasoning']['request_artifact']
 assert req['evidence_digest']==r['forensic_audit']['evidence_digest']

def test_stale_reasoning_response_rejected(tmp_path):
 response={'schema_version':'1.0','evidence_digest':'stale','conclusions':[],'prioritized_actions':[],'challenged_findings':[],'unresolved_questions':[],'confidence':.5,'references_to_known_finding_ids':[]}
 r=run(tmp_path,audit_mode='auto',advertised_capabilities=advertised(host=True),reasoning_response=response)
 assert r['forensic_audit']['reasoning']['status']=='requires_human_review'
 assert 'evidence_digest_mismatch' in r['forensic_audit']['reasoning']['response_validation']['errors']
 assert r['forensic_audit']['static']['executed']

def test_reasoning_cannot_deescalate(tmp_path):
 response={'schema_version':'1.0','evidence_digest':'placeholder','conclusions':[],'prioritized_actions':[],'challenged_findings':[{'proposed_status':'clear'}],'unresolved_questions':[],'confidence':.5,'references_to_known_finding_ids':[]}
 # digest mismatch plus prohibited transition are both rejected.
 r=run(tmp_path,audit_mode='auto',advertised_capabilities=advertised(host=True),reasoning_response=response)
 assert 'prohibited_deescalation' in r['forensic_audit']['reasoning']['response_validation']['errors']

def test_static_only_not_full_reasoning_audit(tmp_path):
 r=run(tmp_path,audit_mode='static_only')
 assert r['preflight_result']['audit_depth']=='deterministic'
 assert 'gate20_reasoning_not_executed' in r['preflight_result']['limitations']

def test_archive_path_traversal_is_rejected():
 from preflight.archive_safety import validate_members
 with pytest.raises(ValueError): validate_members(['../escape'])
 validate_members(['safe/file.txt'])

def test_redaction_removes_tokens():
 from preflight.redaction import redact_all
 out=redact_all({'token':'github_pat_abcdefghijklmnopqrstuvwxyz123456','authorization':'Bearer abc.def'})
 assert 'github_pat_' not in json.dumps(out) and 'Bearer abc.def' not in json.dumps(out)
