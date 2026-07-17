from __future__ import annotations
from pathlib import Path
from typing import Any

KEYS=('README.md','pyproject.toml','setup.py','setup.cfg','package.json','Cargo.toml','go.mod','Dockerfile','Makefile')

def collect(repo: Path) -> dict[str, Any]:
    files=[]
    for p in repo.rglob('*'):
        if p.is_file() and '.git' not in p.parts:
            files.append(str(p.relative_to(repo)))
    texts={}
    for name in KEYS:
        p=repo/name
        if p.is_file(): texts[name]=p.read_text(encoding='utf-8',errors='ignore')
    for p in repo.rglob('*.md'):
        if p.is_file() and '.git' not in p.parts:
            rel=str(p.relative_to(repo)); texts.setdefault(rel,p.read_text(encoding='utf-8',errors='ignore'))
    workflows=sorted(f for f in files if f.startswith('.github/workflows/') and f.endswith(('.yml','.yaml')))
    return {'files':sorted(files),'texts':texts,'workflows':workflows,'complete_tree':True,'source':'filesystem'}
