from __future__ import annotations
import copy
from pathlib import Path
import yaml
DEFAULT={'version':'1.0','gates':{str(i):{'enabled':True,'mandatory':i in (15,17)} for i in range(15,20)}|{'20':{'enabled':True,'mandatory':False,'static_enabled':True,'full_enabled':True,'pr_mode_enabled':True}}}
def load(repo:Path)->dict:
    path=repo/'references'/'audit-policy.yaml'
    if not path.exists(): return copy.deepcopy(DEFAULT)
    try: data=yaml.safe_load(path.read_text(encoding='utf-8'))
    except Exception: return copy.deepcopy(DEFAULT)
    if not isinstance(data,dict) or not isinstance(data.get('gates'),dict): return copy.deepcopy(DEFAULT)
    merged=copy.deepcopy(DEFAULT)
    for gid, default in merged['gates'].items():
        supplied=data['gates'].get(gid,{})
        if isinstance(supplied,dict): default.update(supplied)
        if default.get('mandatory'): default['enabled']=True
    return merged
