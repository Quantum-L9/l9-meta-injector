from __future__ import annotations
import re
from typing import Any

def detect(ev:dict[str,Any], capabilities:dict[str,Any])->list[dict[str,Any]]:
    readme=ev.get('texts',{}).get('README.md','')
    files=set(ev.get('files',[])); results=[]
    observed=[]
    for f in ev.get('workflows',[]):
        text=ev.get('texts',{}).get(f,'')
        if re.search(r'pip install (?:-e )?\.',text): observed.append({'path':f,'behavior':'installs repository as Python package'})
    if observed and not any(x in files for x in ('pyproject.toml','setup.py','setup.cfg')):
        results.append({'id':'CONTRA-PY-INSTALL','declared_model':'workflow/runtime behavior requires repository installation','observed_behavior':observed,'contradiction_status':'contradicted','confidence':0.98,'provenance':[x['path'] for x in observed]+['packaging metadata absent']})
    if re.search(r'external|sdk repository|reusable github actions',readme,re.I) and observed:
        results.append({'id':'CONTRA-DOC-RUNTIME','declared_model':'README describes external SDK or workflow-first ownership','observed_behavior':observed,'contradiction_status':'requires_human_review','confidence':0.78,'provenance':['README.md']+[x['path'] for x in observed]})
    return results
