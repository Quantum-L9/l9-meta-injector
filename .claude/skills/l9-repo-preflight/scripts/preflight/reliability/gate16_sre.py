from __future__ import annotations
from pathlib import Path
from typing import Any
from ..gates.model import EvidenceState, Finding
GATE_ID=16; GATE_NAME='service-reliability'
def _f(i,claim,status,evidence,remediation): return Finding(i,GATE_ID,GATE_NAME,'reliability',claim,'medium',status,0.9,evidence,EvidenceState.OBSERVED,'semantic_index_and_structure','low',remediation,False,[{'source':evidence.get('file','semantic_index')}]).as_dict()
def evaluate(repo:Path,evidence:dict[str,Any],tools:dict[str,dict],ast_facts:dict[str,Any])->list[dict[str,Any]]:
 index=evidence.get('semantic_index',ast_facts.get('semantic_index',{})); facts=index.get('facts',[])
 routes=[f for f in facts if f.get('kind')=='route']
 if not routes:
  routes=[{'kind':'route','name':d.get('name','').rsplit('.',1)[-1],'arguments':d.get('args',[]),'language':'python'} for item in ast_facts.get('files',[]) for d in item.get('decorators',[]) if d.get('name','').endswith(('.get','.post','.put','.patch','.delete'))]
 service=bool(routes) or any((repo/p).exists() for p in ('Dockerfile','docker-compose.yml'))
 if not service:return []
 health=any(any(token in ' '.join(f.get('arguments',[])).lower() for token in ('health','ready','live')) for f in routes)
 out=[]
 if not health: out.append(_f('G16-HEALTH','declared service lacks a discoverable health endpoint','blocker',{'semantic_engine':index.get('engine','UNKNOWN'),'routes_examined':len(routes),'languages':sorted({f.get('language') for f in routes})},'add a real health/readiness endpoint with dependency checks'))
 if not any((repo/p).exists() for p in ('.env.example','.env.sample')): out.append(_f('G16-ENV','service lacks an environment contract example','warning',{'expected':['.env.example','.env.sample']},'add a secret-free environment example'))
 return out
