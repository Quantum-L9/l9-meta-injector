from __future__ import annotations
import re
from pathlib import Path
from typing import Any
from ..gates.model import EvidenceState, Finding
from .dependency_audit import audit as audit_dependencies
GATE_ID=15; GATE_NAME='security-supply-chain'
SECRET_PATTERNS=[re.compile(r'AKIA[0-9A-Z]{16}'),re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),re.compile(r'ghp_[A-Za-z0-9]{36}'),re.compile(r'sk-[A-Za-z0-9]{20,}')]
def _f(i,claim,severity,status,confidence,evidence,state,remediation,risk='low'):
 return Finding(i,GATE_ID,GATE_NAME,'security',claim,severity,status,confidence,evidence,state,'deterministic_or_tool_backed',risk,remediation,False,[{'source':evidence.get('file','tool_registry')}]).as_dict()
def evaluate(repo:Path,evidence:dict[str,Any],tools:dict[str,dict],ast_facts:dict[str,Any])->list[dict[str,Any]]:
 out=[]
 dependency_inventory, dependency_findings = audit_dependencies(repo, tools)
 evidence['dependency_audit'] = dependency_inventory
 out.extend(dependency_findings)
 for path in sorted(repo.rglob('*')):
  if not path.is_file() or any(x in path.relative_to(repo).parts for x in ('tests','fixtures','.git','.venv','node_modules')): continue
  if path.suffix not in {'.py','.js','.ts','.yml','.yaml','.env','.toml','.md'}: continue
  try: text=path.read_text(encoding='utf-8',errors='ignore')
  except OSError: continue
  for lineno,line in enumerate(text.splitlines(),1):
   if any(p.search(line) for p in SECRET_PATTERNS): out.append(_f(f'G15-SECRET-{len(out)+1}','probable hardcoded secret detected','critical','blocker',0.9,{'file':str(path.relative_to(repo)),'line':lineno,'value':'[REDACTED]'},EvidenceState.OBSERVED,'rotate credential and remove literal','medium')); break
 return out
