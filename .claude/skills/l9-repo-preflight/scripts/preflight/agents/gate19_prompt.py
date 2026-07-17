from __future__ import annotations
import re
from pathlib import Path
from typing import Any
from ..gates.model import EvidenceState, Finding
GATE_ID=19; GATE_NAME='prompt-tool-contracts'; TOOL_RE=re.compile(r'^\s*(?:tool|tools)\s*:\s*([A-Za-z_][\w.-]*)',re.I|re.M)
def evaluate(repo:Path,evidence:dict[str,Any],tools:dict[str,dict],ast_facts:dict[str,Any])->list[dict[str,Any]]:
 index=evidence.get('semantic_index',ast_facts.get('semantic_index',{})); facts=index.get('facts',[])
 definitions={f['name'] for f in facts if f.get('kind')=='symbol' and f.get('metadata',{}).get('symbol_kind') in ('function','method','FunctionDef','AsyncFunctionDef')}
 if not definitions:
  definitions={d['name'] for item in ast_facts.get('files',[]) for d in item.get('definitions',[]) if d.get('kind') in ('FunctionDef','AsyncFunctionDef')}
 out=[]
 for path in sorted(repo.rglob('*.md')):
  rel=str(path.relative_to(repo)); text=path.read_text(encoding='utf-8',errors='ignore')
  if not ('# Role' in text and '# Objective' in text): continue
  if not re.search(r'(?im)^\s*version\s*:',text): out.append(Finding(f'G19-VERSION-{len(out)+1}',GATE_ID,GATE_NAME,'agents','prompt lacks a version marker','low','warning',0.99,{'file':rel},EvidenceState.OBSERVED,'document_structure','low','add a version marker',False,[{'source':rel}]).as_dict())
  for name in TOOL_RE.findall(text):
   if name not in definitions: out.append(Finding(f'G19-TOOL-{len(out)+1}',GATE_ID,GATE_NAME,'agents','prompt references an undefined tool','high','blocker',0.95,{'file':rel,'tool':name,'known_semantic_definitions':sorted(definitions),'semantic_engine':index.get('engine','UNKNOWN')},EvidenceState.CONTRADICTED,'semantic_index_plus_document_parse','low','define the tool or correct the prompt reference',False,[{'source':rel},{'source':'semantic_index'}]).as_dict())
 return out
