from __future__ import annotations
import json
from dataclasses import dataclass
from pathlib import Path
@dataclass(frozen=True)
class Command:
 executable:str;arguments:tuple[str,...]
 def to_dict(self):return {'executable':self.executable,'arguments':list(self.arguments)}
@dataclass(frozen=True)
class ValidatorPlan:
 schema_version:str;ecosystem:str;package_manager:str;commands:tuple[Command,...];working_directory:str;environment:dict[str,str]
 def to_dict(self):return {'schema_version':self.schema_version,'ecosystem':self.ecosystem,'package_manager':self.package_manager,'commands':[c.to_dict() for c in self.commands],'working_directory':self.working_directory,'environment':self.environment}
def manager_command(manager,script):return Command(manager,('run',script) if manager=='npm' else (script,))
def resolve_validator_plan(root:Path,profile):
 if profile.package_manager is None:raise ValueError('validator resolution requires an unambiguous package manager')
 pkg=json.loads((root/'package.json').read_text(encoding='utf-8'));scripts=pkg.get('scripts',{}) if isinstance(pkg.get('scripts',{}),dict) else {};selected=[]
 for name in ('typecheck','lint','test','build'):
  if name in scripts:selected.append(manager_command(profile.package_manager,name))
 if profile.typescript and 'typecheck' not in scripts:selected.insert(0,Command('npx',('--no-install','tsc','--noEmit')) if profile.package_manager=='npm' else Command(profile.package_manager,('exec','tsc','--noEmit')) )
 if not selected:raise ValueError('no deterministic validation command could be resolved from package.json')
 return ValidatorPlan('l9.validator-plan.v1','node',profile.package_manager,tuple(selected),'.',{'CI':'true','NODE_ENV':'test'})
