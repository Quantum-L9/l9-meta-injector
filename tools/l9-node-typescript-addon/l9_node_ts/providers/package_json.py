from __future__ import annotations
import json
from pathlib import Path
from ..model import Location,Observation
DEPENDENCY_SECTIONS=('dependencies','devDependencies','optionalDependencies','peerDependencies')
class PackageJsonProvider:
 provider_id='node.package-json'
 def applicable(self,profile):return profile.ecosystem=='node'
 def analyze(self,root:Path,profile):
  out=[]
  for rel in profile.package_json_paths:
   p=root/rel
   try:pkg=json.loads(p.read_text(encoding='utf-8'))
   except Exception as exc:
    out.append(self.obs(rel,'invalid-package-json','correctness','high','package.json is not valid UTF-8 JSON','package managers and build tools cannot interpret the package','repair package.json so it is valid UTF-8 JSON',{'error':str(exc)}));continue
   if not isinstance(pkg.get('name'),str):out.append(self.obs(rel,'missing-package-name','correctness','medium','package.json has no valid package name','tooling cannot reliably identify the package','add a valid package name',{}))
   engines=pkg.get('engines',{})
   if not isinstance(engines,dict) or not isinstance(engines.get('node'),str):out.append(self.obs(rel,'missing-node-engine','compatibility','medium','package.json does not declare a supported Node.js runtime','deployments may run under an incompatible Node.js version','declare engines.node using the runtime range supported by CI and production',{}))
   if profile.package_manager is None:out.append(self.obs(rel,'package-manager-ambiguous','supply-chain','medium','the repository does not identify one package manager','developers and CI may resolve different dependency graphs','set packageManager and commit its matching lockfile',{}))
   seen={}
   for section in DEPENDENCY_SECTIONS:
    deps=pkg.get(section,{})
    if not isinstance(deps,dict):continue
    for name,version in deps.items():
     if name in seen and seen[name]!=section:out.append(self.obs(rel,'duplicate-dependency-section','supply-chain','medium',f'dependency {name!r} appears in multiple dependency sections','installation semantics differ between environments','retain the dependency in one semantically correct section',{'dependency':name,'sections':[seen[name],section]}))
     seen[name]=section
     if isinstance(version,str) and version.strip() in {'*','latest'}:out.append(self.obs(rel,'mutable-dependency-version','supply-chain','high',f'dependency {name!r} uses a mutable version selector','future installs can resolve untested package versions','replace the mutable selector with a reviewed semver range and update the lockfile',{'dependency':name,'version':version,'section':section}))
     if isinstance(version,str) and version.startswith('http://'):out.append(self.obs(rel,'insecure-dependency-url','supply-chain','high',f'dependency {name!r} is downloaded over plain HTTP','the package payload can be modified in transit','use an authenticated HTTPS registry or immutable source',{'dependency':name,'version':version}))
  return out
 def obs(self,path,rule,cat,sev,msg,impact,correction,evidence):return Observation(self.provider_id,rule,cat,sev,.99,path,msg,impact,correction,Location(1),evidence,(path,),sev in {'critical','high'},leverage_score=3.5)
