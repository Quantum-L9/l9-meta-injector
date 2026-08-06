from __future__ import annotations
import re
from dataclasses import dataclass
from pathlib import Path
from ..model import Location,Observation
from ..profile import PRUNE_DIRECTORIES,SOURCE_EXTENSIONS
@dataclass(frozen=True)
class Rule:rule_id:str;category:str;severity:str;pattern:object;message:str;impact:str;correction:str;confidence:float;score:float;exclude_dirs:tuple=()
RULES=(
Rule('eval-usage','security','high',re.compile(r'(?<![A-Za-z0-9_$])eval\s*\('),'dynamic code execution uses eval()','untrusted input can become executable code','replace eval with an explicit parser or allowlisted dispatcher',.98,4.2),
Rule('new-function-usage','security','high',re.compile(r'\bnew\s+Function\s*\('),'dynamic code execution uses the Function constructor','runtime strings can execute with application privileges','replace dynamic compilation with an explicit implementation',.98,4.2),
Rule('insecure-tls-verification','security','critical',re.compile(r'rejectUnauthorized\s*:\s*false'),'TLS certificate verification is disabled','network connections are vulnerable to interception','restore certificate verification and trusted certificate authorities',.99,4.8),
Rule('weak-security-randomness','security','medium',re.compile(r'Math\.random\s*\(\s*\)'),'Math.random() is used in application source','identifiers or tokens derived from it are predictable','use crypto.randomUUID or secure random bytes for security-sensitive values',.75,3.0,exclude_dirs=('tests',)),
Rule('process-exit-library-code','resilience','medium',re.compile(r'\bprocess\.exit\s*\('),'application source terminates the entire Node.js process directly','library or request-path failures can terminate unrelated work','propagate a typed error to the process boundary',.82,3.4,exclude_dirs=('scripts','tests')),
Rule('unbounded-promise-all','resilience','medium',re.compile(r'Promise\.all\s*\(\s*[A-Za-z_$][\w$]*\.map\s*\('),'Promise.all executes a mapped collection without an explicit concurrency limit','large inputs can exhaust resources','use bounded concurrency and propagate cancellation',.8,3.6))
class TypeScriptSourceProvider:
 provider_id='typescript.source'
 def applicable(self,profile):return profile.ecosystem=='node'
 def analyze(self,root:Path,profile):
  out=[]
  for p in sorted(root.rglob('*')):
   if not p.is_file() or p.suffix.lower() not in SOURCE_EXTENSIONS:continue
   rel=p.relative_to(root)
   if any(x in PRUNE_DIRECTORIES for x in rel.parts):continue
   segments=set(rel.parts)
   active=[rule for rule in RULES if not segments.intersection(rule.exclude_dirs)]
   if not active:continue
   try:text=p.read_text(encoding='utf-8')
   except Exception:continue
   for line_no,line in enumerate(text.splitlines(),1):
    for rule in active:
     m=rule.pattern.search(line)
     if m:out.append(Observation(self.provider_id,rule.rule_id,rule.category,rule.severity,rule.confidence,rel.as_posix(),rule.message,rule.impact,rule.correction,Location(line_no,m.start()+1,line_no,m.end()+1),{'matched_text':m.group(0)},(rel.as_posix(),),rule.severity in {'critical','high'},leverage_score=rule.score))
  return out
