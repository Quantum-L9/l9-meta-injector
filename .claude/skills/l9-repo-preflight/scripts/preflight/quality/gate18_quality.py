from __future__ import annotations
from pathlib import Path
from typing import Any
from ..gates.model import EvidenceState, Finding
GATE_ID=18; GATE_NAME='quality-maintainability'
def evaluate(repo:Path,evidence:dict[str,Any],tools:dict[str,dict],ast_facts:dict[str,Any])->list[dict[str,Any]]:
 source=sum(1 for f in evidence.get('files',[]) if f.endswith(('.py','.js','.ts','.tsx')) and not f.startswith('tests/'))
 tests=sum(1 for f in evidence.get('files',[]) if f.startswith('tests/') and f.endswith(('.py','.js','.ts','.tsx')))
 out=[]
 if source>=5 and tests==0: out.append(Finding('G18-TEST-RATIO',GATE_ID,GATE_NAME,'quality','nontrivial source tree has no observed tests','medium','warning',0.95,{'source_files':source,'test_files':tests},EvidenceState.OBSERVED,'structural_count','low','add tests for owned behavior',False,[{'source':'repository_tree'}]).as_dict())
 for tool in ('radon','jscpd','import-linter'):
  if tools[tool]['availability']!='available': out.append(Finding(f'G18-{tool}',GATE_ID,GATE_NAME,'quality',f'{tool} analysis was not observed','low','not_observed',1.0,{'tool':tool,'observed':False},EvidenceState.NOT_OBSERVED,'tool_capability','low',f'provide {tool} when this evidence is required',False,[{'source':'tool_registry'}]).as_dict())
 return out
