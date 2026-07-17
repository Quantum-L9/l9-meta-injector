from __future__ import annotations
from pathlib import Path
from typing import Any
from .environment import detect_environment
from .forensic.gate20 import evaluate as evaluate_gate20
from .gate_capabilities import contracts
from .gate_registry import run as run_extended
from .policy.loader import load as load_policy
from .probe.evidence_collector import collect
from .syntax import build_index
from .tools.registry import discover as discover_tools
from .v35 import run as run_v35

VERSIONS={'skill':'3.9','evaluator':'3.9','schema':'3.9','provider':'3.8','semantic_index':'1.0','tree_sitter':'0.26-compatible','environment':'1.2','gate20':'2.1'}

def run(repo:Path,mode:str='filesystem',capabilities:set[str]|None=None,audit_mode:str='auto',reasoning_provider:Any=None,github_provider:Any=None,repository:str|None=None,pr_number:int|None=None,advertised_capabilities:dict[str,Any]|None=None,reasoning_response:dict[str,Any]|None=None)->dict[str,Any]:
    report=run_v35(repo,mode,capabilities); report['version']='3.9'; report['versions']=dict(VERSIONS)
    evidence=collect(repo); evidence['source']='connector' if mode=='connector' else 'filesystem'
    if mode=='connector': evidence['complete_tree']=False
    tools=discover_tools(); environment=detect_environment(repo,mode,advertised_capabilities,tools)
    semantic_index=build_index(repo); evidence['semantic_index']=semantic_index
    parsers=environment['execution_environment']['parsers']
    for language,key in (('javascript','javascript'),('typescript','typescript'),('bash','shell')):
        available=semantic_index['tree_sitter'].get('grammars',{}).get(language,{}).get('available',False)
        parsers[key]['support']='structural' if available else parsers[key]['support']
        parsers[key]['semantic_provider']='tree_sitter' if available else 'text_fallback'
    from .environment.detector import stable_fingerprint
    environment['environment_fingerprint']=stable_fingerprint(environment)
    ast_facts={'engine':'python.ast','files':[], 'parse_errors':semantic_index['python_ast']['parse_errors']}
    # Preserve legacy gate interfaces while making the shared semantic index primary.
    from .syntax.python_ast import scan_repo
    ast_facts=scan_repo(repo); ast_facts['semantic_index']=semantic_index
    policy=load_policy(repo)
    extended=run_extended(repo,evidence,tools,ast_facts,policy,environment)
    surfaced_before_gate20 = list(report.get('findings', [])) + [f for g in extended for f in g.get('findings', [])]
    gate20=evaluate_gate20(repo,report['repository_profile'],extended,evidence,audit_mode,reasoning_provider,github_provider,repository,pr_number,environment,reasoning_response,all_findings=surfaced_before_gate20)
    gate20_status='warning' if gate20['findings'] or gate20['limitations'] else 'clear'
    extended.append({'gate_id':20,'name':'forensic-synthesis','status':gate20_status,'applicable':True,'findings':gate20['findings'],'evidence_requirements':['gate_results','environment_capability_report','semantic_index'],'execution_requirements':[],'reason':'20A synthesizes normalized semantic and gate evidence; 20B/20C resolve from capabilities','evidence':gate20})
    report['environment_capability_report']=environment; report['environment_capability_report_ref']='environment-capability-report.json'; report['gate_capability_contracts']=contracts()
    report['_semantic_snapshot_runtime']=semantic_index
    report['semantic_index']={'engine':semantic_index['engine'],'tree_sitter':semantic_index['tree_sitter'],'summary':semantic_index['summary'],'files_scanned':len(semantic_index['files'])+semantic_index['python_ast']['files_scanned'],'parse_error_count':len(semantic_index['parse_errors']),'artifact_ref':'semantic-index.json'}
    report['extended_gate_results']=extended; report['tool_capabilities']=tools; report['ast_evidence']={'engine':'python.ast','files_scanned':semantic_index['python_ast']['files_scanned'],'parse_error_count':len(semantic_index['python_ast']['parse_errors'])}; report['audit_policy']=policy; report['forensic_audit']=gate20
    report['findings'].extend(f for g in extended for f in g.get('findings',[]))
    incomplete=[g for g in extended if g['status'] in ('not_observed','requires_human_review','unknown')]
    parser_limitations=[]
    for language,state in semantic_index['tree_sitter'].get('grammars',{}).items():
        if not state.get('available'): parser_limitations.append(f'tree_sitter_{language}_unavailable')
    if semantic_index['parse_errors']: parser_limitations.append('semantic_index_partial_parse')
    full=report['full_preflight'] and not incomplete and not gate20['limitations'] and not parser_limitations
    report['evidence_completeness']={'status':'warning' if incomplete or parser_limitations else 'clear','incomplete_gates':[g['gate_id'] for g in incomplete],'parser_limitations':parser_limitations,'full_preflight':full}; report['full_preflight']=full
    deterministic='blocker' if any(f.get('status')=='blocker' for f in report['findings']) else ('warning' if report['findings'] or incomplete or parser_limitations else 'clear')
    status=deterministic if not (deterministic=='clear' and (gate20['limitations'] or parser_limitations)) else 'clear_with_limitations'
    report['preflight_result']={'status':status,'execution_depth':mode,'audit_depth':gate20['audit_depth'],'environment_capability_report_ref':'environment-capability-report.json','limitations':environment['capability_limitations']+gate20['limitations']+parser_limitations,'deterministic_status':deterministic,'reasoning_assessment':'completed' if gate20['reasoning']['executed'] else 'not_observed','final_status':deterministic,'confidence':gate20['confidence']}
    return report
