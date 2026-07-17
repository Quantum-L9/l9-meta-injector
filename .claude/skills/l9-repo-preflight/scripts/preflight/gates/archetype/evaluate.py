from __future__ import annotations
from pathlib import Path
from typing import Any
from ..model import gate

def evaluate(repo:Path,profile:dict[str,Any],caps:dict[str,Any],ctx)->list[dict[str,Any]]:
    by={c['name']:c for c in caps['capabilities']}; out=[]
    py=by['installable_python_package']; active=set(profile['active_archetypes'])
    if 'python-package' in active:
        status='clear' if py['status']=='matched' else 'blocker'
        out.append(gate('A-PY-01','python-packaging-metadata',status,['recursive_tree'],{'capability':py}))
    else: out.append(gate('A-PY-01','python-packaging-metadata','not_applicable',['recursive_tree'],{'active_archetypes':sorted(active)}))
    if 'reusable-workflows' in active:
        out.append(gate('A-WF-01','reusable-workflow-contract','clear',['repository_read'],{'capability':by['reusable_github_workflows']}))
    else: out.append(gate('A-WF-01','reusable-workflow-contract','not_applicable',['repository_read']))
    return out
