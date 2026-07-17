from __future__ import annotations
from pathlib import Path
import yaml

def load_workflows(repo:Path):
 out=[]
 for p in sorted((repo/'.github/workflows').glob('*.y*ml')) if (repo/'.github/workflows').is_dir() else []:
  try: data=yaml.safe_load(p.read_text(encoding='utf-8')) or {}
  except Exception: data={}
  out.append({'path':str(p.relative_to(repo)),'data':data,'text':p.read_text(encoding='utf-8',errors='ignore')})
 return out
