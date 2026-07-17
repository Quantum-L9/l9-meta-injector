from pathlib import Path
from preflight.v36 import run
from preflight.syntax.python_ast import scan_repo
from preflight.gate_registry import REGISTRY
from preflight.providers.reasoning import ActionRequestProvider

def gate(report,gid): return next(g for g in report['extended_gate_results'] if g['gate_id']==gid)

def test_registry_contains_only_15_to_19(): assert set(REGISTRY)=={15,16,17,18,19}
def test_ast_detects_functions_calls_fields_and_decorators(tmp_path):
 (tmp_path/'app.py').write_text("from fastapi import FastAPI\napp=FastAPI()\n@app.get('/health')\ndef health():\n return {'ok':True}\nclass User:\n email:str\ndef upgrade():\n op.drop_table('x')\n")
 facts=scan_repo(tmp_path); f=facts['files'][0]
 assert any(x['name']=='health' for x in f['definitions']); assert any(x['name']=='app.get' for x in f['decorators']); assert any(x['name']=='op.drop_table' for x in f['calls']); assert any(x['name']=='email' for x in f['annotated_fields'])
def test_gate15_tool_absence_is_not_observed(tmp_path,monkeypatch):
 (tmp_path/'pyproject.toml').write_text("[project]\nname='x'\n")
 monkeypatch.setattr('shutil.which',lambda _:None)
 r=run(tmp_path); assert gate(r,15)['status']=='not_observed'
def test_gate16_ast_health_endpoint_clears(tmp_path):
 (tmp_path/'app.py').write_text("from fastapi import FastAPI\napp=FastAPI()\n@app.get('/health')\ndef health(): return {'ok':True}\n")
 (tmp_path/'.env.example').write_text('PORT=8000\n')
 r=run(tmp_path); assert gate(r,16)['status']=='clear'
def test_gate17_ast_destructive_migration_blocks(tmp_path):
 d=tmp_path/'migrations'; d.mkdir(); (d/'001.py').write_text("def upgrade():\n op.drop_table('users')\n")
 r=run(tmp_path); assert gate(r,17)['status']=='blocker'
def test_gate19_undefined_tool_blocks(tmp_path):
 (tmp_path/'tools.py').write_text('def real_tool(): pass\n')
 (tmp_path/'prompt.md').write_text('# Role\nAgent\n# Objective\nWork\nversion: 1\ntool: absent_tool\n')
 r=run(tmp_path); assert gate(r,19)['status']=='blocker'
def test_gate20_static_synthesizes_prior_findings(tmp_path):
 d=tmp_path/'migrations'; d.mkdir(); (d/'001.py').write_text("def upgrade():\n op.drop_table('users')\n")
 r=run(tmp_path); assert gate(r,20)['findings']
def test_gate20_full_without_provider_is_honest(tmp_path):
 r=run(tmp_path,audit_mode='full'); assert r['forensic_audit']['provider_receipts'][0]['action']=='llm_audit_required'; assert r['full_preflight'] is False
def test_gate20_pr_without_executor_emits_mcp_request(tmp_path):
 r=run(tmp_path,audit_mode='pr',repository='Quantum-L9/l9-ci-core',pr_number=1)
 assert r['forensic_audit']['provider_receipts'][0]['provider']=='github_mcp_action_request'
def test_versions_are_explicit(tmp_path):
 r=run(tmp_path); assert r['versions']=={'skill':'3.6','evaluator':'3.6','schema':'3.6','provider':'3.3','ast':'python.ast'}
def test_mandatory_gate_crash_cannot_clear(tmp_path,monkeypatch):
 import preflight.gate_registry as gr
 (tmp_path/'pyproject.toml').write_text("[project]\nname='x'\n")
 monkeypatch.setattr(gr.MODULES[15],'evaluate',lambda *a,**k: (_ for _ in ()).throw(RuntimeError('boom')))
 r=run(tmp_path); assert gate(r,15)['status']=='requires_human_review'; assert r['full_preflight'] is False
def test_connector_mode_never_claims_full(tmp_path):
 r=run(tmp_path,mode='connector'); assert r['full_preflight'] is False
