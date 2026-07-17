from __future__ import annotations
from dataclasses import dataclass
from typing import Any
from pathlib import Path
import yaml

@dataclass(frozen=True)
class ArchetypeScore:
    name: str; score: int; confidence: float; status: str; evidence: tuple[str,...]

def _status(score:int)->str:
    if score>=8:return 'matched'
    if score>=5:return 'likely'
    if score>=2:return 'possible'
    if score<=-3:return 'contradicted'
    return 'unknown'

def _catalog()->dict[str,Any]:
    root=Path(__file__).resolve().parents[3]
    out={}
    for p in sorted((root/'profiles').glob('*.yaml')):
        out[p.stem]=yaml.safe_load(p.read_text(encoding='utf-8'))
    return out

def infer(ev:dict[str,Any])->dict[str,Any]:
    files=set(ev.get('files',[])); readme=ev.get('texts',{}).get('README.md','').lower()
    scores={k:[0,[]] for k in ('application','python-package','node-package','reusable-workflows','infrastructure','schemas-contracts','documentation','policy-governance','monorepo')}
    def add(k,n,msg): scores[k][0]+=n; scores[k][1].append(msg)
    if any(f.startswith('.github/workflows/') for f in files): add('reusable-workflows',4,'workflow files present')
    if any('workflow_call:' in (ev.get('texts',{}).get(f,'') or '') for f in ev.get('workflows',[])): add('reusable-workflows',5,'workflow_call present')
    if 'reusable github actions' in readme or 'reusable workflow' in readme: add('reusable-workflows',6,'README declares reusable workflows')
    if 'pyproject.toml' in files or 'setup.py' in files or 'setup.cfg' in files: add('python-package',8,'Python packaging metadata present')
    if any(f.endswith('.py') for f in files): add('python-package',1,'Python source present')
    if 'package.json' in files: add('node-package',8,'package.json present')
    if any(f.endswith(('.tf','.tfvars')) for f in files): add('infrastructure',8,'Terraform present')
    if any('/schemas/' in '/'+f or f.startswith('schemas/') for f in files): add('schemas-contracts',5,'schema directory present')
    if any(f.startswith('docs/') for f in files): add('documentation',3,'documentation tree present')
    if any('governance' in f.lower() or 'policy' in f.lower() for f in files): add('policy-governance',5,'governance/policy artifacts present')
    manifests=sum(x in files for x in ('pyproject.toml','package.json','Cargo.toml','go.mod'))
    if manifests>=2:add('monorepo',6,'multiple ecosystem manifests present')
    out=[]
    for k,(score,evidence) in scores.items():
        out.append({'name':k,'score':score,'confidence':min(0.99,max(0.25,0.5+abs(score)/20)),'status':_status(score),'evidence':evidence})
    active=[x for x in out if x['status'] in ('matched','likely')]
    return {'archetypes':out,'active_archetypes':[x['name'] for x in active],'classification_confidence':max([x['confidence'] for x in active],default=0.25),'profile_catalog':sorted(_catalog())}
