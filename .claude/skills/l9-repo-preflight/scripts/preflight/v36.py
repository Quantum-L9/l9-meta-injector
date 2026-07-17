from __future__ import annotations
from pathlib import Path
from typing import Any
from .v35 import run as run_v35
from .gate_registry import run as run_extended
from .policy.loader import load as load_policy
from .tools.registry import discover as discover_tools
from .syntax.python_ast import scan_repo
from .forensic.gate20 import evaluate as evaluate_gate20
VERSIONS={'skill':'3.6','evaluator':'3.6','schema':'3.6','provider':'3.3','ast':'python.ast'}
def run(repo:Path,mode:str='filesystem',capabilities:set[str]|None=None,audit_mode:str='static',reasoning_provider=None,github_provider=None,repository:str|None=None,pr_number:int|None=None)->dict[str,Any]:
 report=run_v35(repo,mode,capabilities)
 report['version']='3.6'; report['versions']=dict(VERSIONS)
 evidence={'files':report.get('repository_profile',{}).get('files',[])}
 # Recollect canonical evidence because v3.5 intentionally does not expose raw evidence.
 from .probe.evidence_collector import collect
 evidence=collect(repo)
 if mode=='connector': evidence['complete_tree']=False; evidence['source']='connector'
 ast_facts=scan_repo(repo); tools=discover_tools(); policy=load_policy(repo)
 extended=run_extended(repo,evidence,tools,ast_facts,policy)

 if audit_mode=='full' and reasoning_provider is None:
  from .environment.detector import detect_environment
  legacy_env=detect_environment(repo, mode, {'reasoning_provider':{'host_agent_session':True,'external_provider_configured':False,'credentials_available':False}})
 else: legacy_env=None
 gate20=evaluate_gate20(repo,report['repository_profile'],extended,evidence,audit_mode,reasoning_provider,github_provider,repository,pr_number,legacy_env)
 gate20_status='warning' if gate20['findings'] else ('not_observed' if gate20['audit_limitations'] else 'clear')
 extended.append({'gate_id':20,'name':'forensic-synthesis','status':gate20_status,'applicable':True,'findings':gate20['findings'],'evidence_requirements':['gate_results','provider_receipts'],'execution_requirements':[],'reason':'synthesizes Gates 9-19','evidence':gate20})
 report['extended_gate_results']=extended; report['tool_capabilities']=tools; report['ast_evidence']={'engine':ast_facts['engine'],'files_scanned':len(ast_facts['files']),'parse_error_count':len(ast_facts['parse_errors'])}; report['audit_policy']=policy; report['forensic_audit']=gate20
 report['findings'].extend(f for g in extended for f in g.get('findings',[]))
 missing=[g for g in extended if g['status'] in ('not_observed','requires_human_review')]
 report['evidence_completeness']={'status':'warning' if missing else 'clear','incomplete_gates':[g['gate_id'] for g in missing],'full_preflight':report['full_preflight'] and not missing}
 report['full_preflight']=report['evidence_completeness']['full_preflight']
 return report
