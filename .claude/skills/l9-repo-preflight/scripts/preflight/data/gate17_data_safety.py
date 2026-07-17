from __future__ import annotations
from pathlib import Path
from typing import Any
from ..gates.model import EvidenceState, Finding
GATE_ID=17; GATE_NAME='data-safety'
DESTRUCTIVE={'op.drop_table','op.drop_column','drop_table','drop_column','drop','delete','remove'}; CREATIVE={'op.create_table','op.add_column','create_table','add_column','create','insert'}; PII={'email','ssn','social_security_number','phone','address','date_of_birth'}
def _f(i,claim,severity,status,evidence,remediation,risk='low'): return Finding(i,GATE_ID,GATE_NAME,'data',claim,severity,status,0.94,evidence,EvidenceState.OBSERVED,'normalized_semantic_index','low',remediation,False,[{'source':evidence.get('file','semantic_index')}]).as_dict()
def evaluate(repo:Path,evidence:dict[str,Any],tools:dict[str,dict],ast_facts:dict[str,Any])->list[dict[str,Any]]:
 index=evidence.get('semantic_index',ast_facts.get('semantic_index',{})); facts=index.get('facts',[]); out=[]
 if not facts:
  for item in ast_facts.get('files',[]):
   for call in item.get('calls',[]):
    receiver,name=(call.get('name','').rsplit('.',1) if '.' in call.get('name','') else (None,call.get('name','')))
    facts.append({'kind':'call','name':name,'receiver':receiver,'path':item.get('path'),'range':{'start_line':call.get('line',0)},'provider':'python_ast','native_node_type':'Call'})
   for field in item.get('annotated_fields',[]): facts.append({'kind':'field','name':field.get('name'),'path':item.get('path'),'range':{'start_line':field.get('line',0)},'provider':'python_ast'})
 by_file={}
 for fact in facts: by_file.setdefault(fact.get('path','UNKNOWN'),[]).append(fact)
 for path,items in by_file.items():
  calls=[f for f in items if f.get('kind')=='call']; names={('.'.join(filter(None,[f.get('receiver'),f.get('name')]))).lower() for f in calls}
  for call in calls:
   full='.'.join(filter(None,[call.get('receiver'),call.get('name')])).lower()
   if full in DESTRUCTIVE or call.get('name','').lower() in DESTRUCTIVE:
    if not any(name in CREATIVE or name.rsplit('.',1)[-1] in CREATIVE for name in names): out.append(_f(f'G17-MIG-{len(out)+1}','destructive data operation lacks compensating creation/backfill evidence','critical','blocker',{'file':path,'line':call['range']['start_line'],'call':full,'provider':call.get('provider'),'native_node_type':call.get('native_node_type')},'write an explicit reversible migration, backup, and backfill plan'))
  for field in [f for f in items if f.get('kind')=='field']:
   if field.get('name','').lower() in PII: out.append(_f(f'G17-PII-{len(out)+1}','PII field requires explicit protection evidence','high','requires_human_review',{'file':path,'line':field['range']['start_line'],'field':field['name'],'provider':field.get('provider')},'document encryption, hashing, retention, and access controls','medium'))
 return out
