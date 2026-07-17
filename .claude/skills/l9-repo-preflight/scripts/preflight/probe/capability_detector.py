from __future__ import annotations
from typing import Any

def detect(ev:dict[str,Any], profile:dict[str,Any])->dict[str,Any]:
    files=set(ev.get('files',[])); caps=[]
    def cap(name,status,evidence,confidence): caps.append({'name':name,'status':status,'evidence':evidence,'confidence':confidence})
    w=ev.get('workflows',[])
    cap('reusable_github_workflows','matched' if w else 'unknown',w,0.99 if w else 0.4)
    packaging=[x for x in ('pyproject.toml','setup.py','setup.cfg') if x in files]
    python_src=any(f.endswith('.py') for f in files)
    cap('installable_python_package','matched' if packaging else ('contradicted' if python_src else 'unknown'),packaging or ['python source without packaging metadata'] if python_src else [],0.98 if packaging else 0.85 if python_src else 0.4)
    cap('node_package','matched' if 'package.json' in files else 'unknown',['package.json'] if 'package.json' in files else [],0.99 if 'package.json' in files else 0.4)
    cap('schema_contracts','likely' if any(f.startswith('schemas/') for f in files) else 'unknown',[f for f in files if f.startswith('schemas/')][:20],0.85)
    cap('documentation','matched' if 'README.md' in files else 'possible',[f for f in files if f=='README.md' or f.startswith('docs/')][:20],0.95 if 'README.md' in files else 0.55)
    return {'capabilities':caps}
