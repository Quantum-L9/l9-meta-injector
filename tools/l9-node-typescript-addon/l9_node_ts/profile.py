from __future__ import annotations
import json
from dataclasses import asdict,dataclass
from pathlib import Path
from typing import Any
from .model import normalize_path,stable_digest
PRUNE_DIRECTORIES={'.git','.next','.nuxt','.output','.turbo','.yarn','build','coverage','dist','node_modules','out'}
LOCKFILE_TO_MANAGER={'pnpm-lock.yaml':'pnpm','yarn.lock':'yarn','package-lock.json':'npm','npm-shrinkwrap.json':'npm','bun.lock':'bun','bun.lockb':'bun'}
SOURCE_EXTENSIONS={'.js','.jsx','.mjs','.cjs','.ts','.tsx','.mts','.cts'}
@dataclass(frozen=True)
class RepositoryProfile:
 schema_version:str;ecosystem:str;languages:tuple[str,...];package_manager:str|None;package_manager_source:str|None;package_manager_version:str|None;module_system:str;typescript:bool;workspace:bool;monorepo:bool;package_json_paths:tuple[str,...];tsconfig_paths:tuple[str,...];lockfiles:tuple[str,...];source_file_count:int;profile_warnings:tuple[str,...];fingerprint:str
 def to_dict(self):
  d=asdict(self)
  for k in ('languages','package_json_paths','tsconfig_paths','lockfiles','profile_warnings'):d[k]=list(d[k])
  return d
def _pm(pkg:dict[str,Any]):
 raw=pkg.get('packageManager')
 if not isinstance(raw,str) or not raw.strip():return None,None
 manager,sep,version=raw.partition('@')
 return (manager,version if sep else None) if manager in {'npm','pnpm','yarn','bun'} else (None,None)
def discover_files(root:Path):
 packages=[];tsconfigs=[];locks=[];sources=0
 for p in sorted(root.rglob('*')):
  if any(x in PRUNE_DIRECTORIES for x in p.relative_to(root).parts) or not p.is_file():continue
  if p.name=='package.json':packages.append(p)
  if p.name=='tsconfig.json' or (p.name.startswith('tsconfig.') and p.suffix=='.json'):tsconfigs.append(p)
  if p.name in LOCKFILE_TO_MANAGER:locks.append(p)
  if p.suffix.lower() in SOURCE_EXTENSIONS:sources+=1
 return packages,tsconfigs,locks,sources
def profile_repository(root:Path)->RepositoryProfile:
 root=root.resolve(); packages,tsconfigs,locks,sources=discover_files(root)
 if not packages:raise ValueError('repository is not a Node.js repository: package.json was not found')
 primary=root/'package.json' if (root/'package.json') in packages else packages[0]
 pkg=json.loads(primary.read_text(encoding='utf-8'));declared,version=_pm(pkg);families={LOCKFILE_TO_MANAGER[p.name] for p in locks};warnings=[]
 if len(families)>1:warnings.append('multiple package-manager lockfile families were detected')
 if declared:
  manager=declared;source='package.json#packageManager'
  if families and declared not in families:warnings.append('packageManager conflicts with detected lockfile family')
 elif len(families)==1:manager=next(iter(families));source='lockfile'
 else:manager=source=None
 langs={'javascript'}
 if tsconfigs or any(p.suffix.lower() in {'.ts','.tsx','.mts','.cts'} for p in root.rglob('*') if p.is_file()):langs.add('typescript')
 workspace=isinstance(pkg.get('workspaces'),(list,dict)) or (root/'pnpm-workspace.yaml').is_file(); identities={'ecosystem':'node','languages':sorted(langs),'package_manager':manager,'package_manager_version':version,'module_system':'esm' if pkg.get('type')=='module' else 'commonjs','workspace':workspace,'package_json_paths':[normalize_path(p,root) for p in packages],'tsconfig_paths':[normalize_path(p,root) for p in tsconfigs],'lockfiles':[normalize_path(p,root) for p in locks]}
 return RepositoryProfile('l9.repository-profile.v1','node',tuple(sorted(langs)),manager,source,version,identities['module_system'],'typescript' in langs,workspace,workspace or len(packages)>1,tuple(identities['package_json_paths']),tuple(identities['tsconfig_paths']),tuple(identities['lockfiles']),sources,tuple(warnings),stable_digest(identities))
