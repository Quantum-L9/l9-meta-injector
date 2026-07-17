from __future__ import annotations
from pathlib import Path
from typing import Any
from .v35 import run as run_v35
from .gate_registry import run as run_extended
from .policy.loader import load as load_policy
from .tools.registry import discover as discover_tools
from .syntax.python_ast import scan_repo
from .forensic.gate20 import evaluate as evaluate_gate20
from .environment import detect_environment
from .gate_capabilities import contracts
VERSIONS={'skill':'3.7','evaluator':'3.7','schema':'3.7','provider':'3.7','ast':'python.ast','environment':'1.0','gate20':'2.0'}
def run(repo:Path,mode:str='filesystem',capabilities:set[str]|None=None,audit_mode:str='auto',reasoning_provider=None,github_provider=None,repository:str|None=None,pr_number:int|None=None,advertised_capabilities:dict[str,Any]|None=None,reasoning_response:dict[str,Any]|None=None)->dict[str,Any]:
 report=run_v35(repo,mode,capabilities); report['version']='3.7'; report['versions']=dict(VERSIONS)
 from .probe.evidence_collector import collect
 evidence=collect(repo)
 if mode=='connector': evidence['complete_tree']=False; evidence['source']='connector'
 else: evidence['source']='filesystem'
 environment=detect_environment(repo,mode,advertised_capabilities)
 ast_facts=scan_repo(repo); tools=discover_tools(); policy=load_policy(repo)
 extended=run_extended(repo,evidence,tools,ast_facts,policy)
 gate20=evaluate_gate20(repo,report['repository_profile'],extended,evidence,audit_mode,reasoning_provider,github_provider,repository,pr_number,environment,reasoning_response)
 gate20_status='warning' if gate20['findings'] or gate20['limitations'] else 'clear'
 extended.append({'gate_id':20,'name':'forensic-synthesis','status':gate20_status,'applicable':True,'findings':gate20['findings'],'evidence_requirements':['gate_results','environment_capability_report'],'execution_requirements':[],'reason':'20A always runs; 20B/20C resolve from environment capabilities','evidence':gate20})
 report['environment_capability_report']=environment; report['environment_capability_report_ref']='environment-capability-report.json'; report['gate_capability_contracts']=contracts()
 report['extended_gate_results']=extended; report['tool_capabilities']=tools; report['ast_evidence']={'engine':ast_facts['engine'],'files_scanned':len(ast_facts['files']),'parse_error_count':len(ast_facts['parse_errors'])}; report['audit_policy']=policy; report['forensic_audit']=gate20
 report['findings'].extend(f for g in extended for f in g.get('findings',[]))
 missing=[g for g in extended if g['status'] in ('not_observed','requires_human_review')]
 report['evidence_completeness']={'status':'warning' if missing else 'clear','incomplete_gates':[g['gate_id'] for g in missing],'full_preflight':report['full_preflight'] and not missing and not gate20['limitations']}
 report['full_preflight']=report['evidence_completeness']['full_preflight']
 deterministic='blocker' if any(f.get('status')=='blocker' for f in report['findings']) else ('warning' if report['findings'] or missing else 'clear')
 report['preflight_result']={'status':deterministic if not gate20['limitations'] else ('clear_with_limitations' if deterministic=='clear' else deterministic),'execution_depth':mode,'audit_depth':gate20['audit_depth'],'environment_capability_report_ref':'environment-capability-report.json','limitations':environment['capability_limitations']+gate20['limitations'],'deterministic_status':deterministic,'reasoning_assessment':'completed' if gate20['reasoning']['executed'] else 'not_observed','final_status':deterministic,'confidence':gate20['confidence']}
 return report
