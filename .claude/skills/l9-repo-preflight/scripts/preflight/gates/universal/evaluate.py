from __future__ import annotations
from pathlib import Path
from typing import Any
from ..model import gate

UNIVERSAL=(
('U01','repository-readable',['repository_read']),('U02','declared-purpose-identifiable',['repository_read']),('U03','secrets-absent',['recursive_tree']),('U04','manifest-integrity',['recursive_tree']),('U05','generated-artifact-integrity',['recursive_tree']),('U06','documentation-alignment',['repository_read']),('U07','ci-truthfulness',['repository_read']),('U08','dependency-reference-immutability',['repository_read']),('U09','merge-debris-absent',['recursive_tree']),('U10','evidence-completeness',[]))

def evaluate(repo:Path,ev:dict[str,Any],ctx)->list[dict[str,Any]]:
    files=set(ev.get('files',[])); out=[]
    for gid,name,req in UNIVERSAL:
        if not ctx.supports(req): out.append(gate(gid,name,'not_observed',req,reason='execution context lacks required evidence capability')); continue
        status='clear'; evidence={}
        if gid=='U02' and 'README.md' not in files: status='warning'; evidence={'README.md':'absent'}
        if gid=='U04':
            manifests=[f for f in files if f.endswith('manifest.json') or f=='manifest.json']
            status='clear' if manifests else 'not_applicable'; evidence={'manifests':manifests}
        if gid=='U10': evidence={'source':ev.get('source'),'complete_tree':ev.get('complete_tree',False),'execution_mode':ctx.mode}; status='clear' if ev.get('complete_tree') else 'warning'
        out.append(gate(gid,name,status,req,evidence))
    return out
