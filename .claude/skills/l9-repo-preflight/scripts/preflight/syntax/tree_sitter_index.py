from __future__ import annotations
from pathlib import Path
from typing import Any
from .language_detector import detect,eligible
from .models import SemanticFact,SourceRange
from .tree_sitter_runtime import inspect_runtime,parser_for
from .python_ast import scan_repo as scan_python_ast
from ..intelligence.contracts import CoverageLedger
from ..intelligence.snapshot import create_snapshot, stable_fact_id

SYMBOL_TYPES={'function_definition':'function','function_declaration':'function','method_definition':'method','class_definition':'class','class_declaration':'class','interface_declaration':'interface','type_alias_declaration':'type','lexical_declaration':'declaration','variable_declaration':'declaration'}
CALL_TYPES={'call','call_expression','command'}
IMPORT_TYPES={'import_statement','import_from_statement','import_declaration','require_call'}
EXPORT_TYPES={'export_statement'}
FIELD_TYPES={'public_field_definition','property_signature','annotated_assignment'}
ROUTE_METHODS={'get','post','put','patch','delete','options','head'}

def _text(source:bytes,node)->str: return source[node.start_byte:node.end_byte].decode('utf-8','replace')
def _range(node)->SourceRange: return SourceRange(node.start_point.row+1,node.start_point.column,node.end_point.row+1,node.end_point.column,node.start_byte,node.end_byte)
def _child(node,*fields):
    for field in fields:
        child=node.child_by_field_name(field)
        if child is not None:return child
    return None

def _walk(node):
    stack=[node]
    while stack:
        current=stack.pop(); yield current; stack.extend(reversed(current.children))

def _name_for(node,source:bytes)->str:
    child=_child(node,'name','declarator','function','property')
    return _text(source,child).strip() if child else _text(source,node).strip().splitlines()[0][:200]

def _fact(kind,name,language,path,node,state,**kwargs):
    grammar=state.grammars.get(language,{})
    return SemanticFact(kind,name,language,path,_range(node),node.type,'tree_sitter',state.version,grammar.get('version','UNKNOWN'),**kwargs).as_dict()

def _parse_file(path:Path,repo:Path,language:str)->dict[str,Any]:
    parser,state=parser_for(language); rel=str(path.relative_to(repo)); source=path.read_bytes()
    if parser is None:return {'path':rel,'language':language,'provider':'unavailable','parse_status':'not_observed','facts':[],'errors':[state.error or 'grammar_unavailable']}
    tree=parser.parse(source); facts=[]; errors=[]
    for node in _walk(tree.root_node):
        if node.type=='ERROR' or node.is_missing: errors.append({'type':node.type,'range':_range(node).__dict__})
        if node.type in SYMBOL_TYPES:
            facts.append(_fact('symbol',_name_for(node,source),language,rel,node,state,metadata={'symbol_kind':SYMBOL_TYPES[node.type]}))
        elif node.type in IMPORT_TYPES:
            facts.append(_fact('import',_text(source,node)[:500],language,rel,node,state))
        elif node.type in EXPORT_TYPES:
            facts.append(_fact('export',_text(source,node)[:500],language,rel,node,state))
        elif node.type in FIELD_TYPES:
            facts.append(_fact('field',_name_for(node,source),language,rel,node,state))
        elif node.type in CALL_TYPES:
            fn=_child(node,'function','name'); fn_text=_text(source,fn).strip() if fn else _name_for(node,source)
            args=_child(node,'arguments'); arg_text=tuple([_text(source,c).strip() for c in args.named_children]) if args else ()
            receiver,method=(fn_text.rsplit('.',1) if '.' in fn_text else (None,fn_text))
            metadata={'awaited':node.parent is not None and node.parent.type=='await_expression'}
            facts.append(_fact('call',method,language,rel,node,state,receiver=receiver,arguments=arg_text,metadata=metadata))
            if method.lower() in ROUTE_METHODS:
                facts.append(_fact('route',method.lower(),language,rel,node,state,receiver=receiver,arguments=arg_text))
        if node.type in {'try_statement','try'}: facts.append(_fact('error_handler','try',language,rel,node,state))
    return {'path':rel,'language':language,'provider':'tree_sitter','parse_status':'partial' if errors else 'complete','facts':facts,'errors':errors}

def build_index(repo:Path)->dict[str,Any]:
    state=inspect_runtime(); files=[]
    for path in sorted(repo.rglob('*')):
        if path.is_file() and eligible(path,repo):
            language=detect(path)
            if language=='python': continue
            files.append(_parse_file(path,repo,language))
    py=scan_python_ast(repo); pyfacts=[]
    for item in py['files']:
        for d in item['definitions']:
            pyfacts.append({'kind':'symbol','name':d['name'],'language':'python','path':item['path'],'range':{'start_line':d['line'],'start_column':0,'end_line':d['line'],'end_column':0,'start_byte':0,'end_byte':0},'native_node_type':d['kind'],'provider':'python_ast','provider_version':'stdlib','grammar_version':'stdlib','receiver':None,'arguments':[],'metadata':{'symbol_kind':d['kind']}})
        for c in item['calls']:
            receiver,method=(c['name'].rsplit('.',1) if '.' in c['name'] else (None,c['name']))
            pyfacts.append({'kind':'call','name':method,'language':'python','path':item['path'],'range':{'start_line':c['line'],'start_column':0,'end_line':c['line'],'end_column':0,'start_byte':0,'end_byte':0},'native_node_type':'Call','provider':'python_ast','provider_version':'stdlib','grammar_version':'stdlib','receiver':receiver,'arguments':c['args'],'metadata':{}})
        for imp in item.get('imports',[]):
            pyfacts.append({'kind':'import','name':imp['text'],'language':'python','path':item['path'],'range':{'start_line':imp['line'],'start_column':0,'end_line':imp['line'],'end_column':0,'start_byte':0,'end_byte':0},'native_node_type':'Import','provider':'python_ast','provider_version':'stdlib','grammar_version':'stdlib','receiver':None,'arguments':[],'metadata':{}})
        for d in item['decorators']:
            method=d['name'].rsplit('.',1)[-1]
            if method.lower() in ROUTE_METHODS: pyfacts.append({'kind':'route','name':method.lower(),'language':'python','path':item['path'],'range':{'start_line':d['line'],'start_column':0,'end_line':d['line'],'end_column':0,'start_byte':0,'end_byte':0},'native_node_type':'decorator','provider':'python_ast','provider_version':'stdlib','grammar_version':'stdlib','receiver':d['name'].rsplit('.',1)[0] if '.' in d['name'] else None,'arguments':d['args'],'metadata':{'target':d['target']}})
    allfacts=pyfacts+[fact for item in files for fact in item['facts']]
    eligible_paths=[str(path.relative_to(repo)) for path in sorted(repo.rglob('*')) if path.is_file() and eligible(path,repo)]
    snapshot=create_snapshot(repo,eligible_paths)
    for fact in allfacts:
        fact['qualified_name']=fact.get('metadata',{}).get('qualified_name') or fact.get('name')
        fact['authority']={
            'syntax':'native_ast' if fact.get('provider')=='python_ast' else 'structural_parse',
            'resolution':'unresolved',
        }
        fact['confidence_class']='observed'
        fact['limitations']=[]
        fact['extractor']={
            'name':fact.get('provider','UNKNOWN'),
            'version':fact.get('provider_version','UNKNOWN'),
            'grammar_version':fact.get('grammar_version','UNKNOWN'),
        }
        fact['fact_id']=stable_fact_id(snapshot.repository_snapshot_id,fact)
    parse_errors=[{'path':i['path'],'errors':i['errors']} for i in files if i['errors']]+py['parse_errors']
    coverage_by_language={}
    for path in eligible_paths:
        language=detect(repo/path)
        bucket=coverage_by_language.setdefault(language,{'eligible':0,'parsed':0,'failed':0,'unsupported':0})
        bucket['eligible']+=1
    for item in files:
        bucket=coverage_by_language.setdefault(item['language'],{'eligible':0,'parsed':0,'failed':0,'unsupported':0})
        if item['parse_status']=='not_observed': bucket['unsupported']+=1
        elif item['parse_status']=='partial': bucket['parsed']+=1; bucket['failed']+=1
        else: bucket['parsed']+=1
    pybucket=coverage_by_language.setdefault('python',{'eligible':0,'parsed':0,'failed':0,'unsupported':0})
    pybucket['parsed']=len(py['files']); pybucket['failed']=len(py['parse_errors'])
    unsupported=sum(v['unsupported'] for v in coverage_by_language.values())
    failed=len(parse_errors)
    parsed=len(py['files'])+sum(1 for item in files if item['parse_status']!='not_observed')
    coverage=CoverageLedger(len(eligible_paths),parsed,unsupported,failed,0,coverage_by_language,tuple(
        sorted({f'{lang}_semantic_depth_limited' for lang,state_ in coverage_by_language.items() if state_['unsupported'] or lang not in {'python','javascript','typescript','bash'}})
    ))
    return {
        'engine':'hybrid_semantic_index',
        'intelligence_plane':'l9_repository_intelligence_plane',
        'repository_snapshot':snapshot.as_dict(),
        'coverage_ledger':coverage.as_dict(),
        'tree_sitter':{'available':state.available,'version':state.version,'grammars':state.grammars,'error':state.error},
        'files':files,
        'python_ast':{'files_scanned':len(py['files']),'parse_errors':py['parse_errors']},
        'facts':allfacts,
        'parse_errors':parse_errors,
        'summary':{kind:sum(1 for f in allfacts if f['kind']==kind) for kind in ('symbol','import','export','call','route','field','error_handler')},
    }
