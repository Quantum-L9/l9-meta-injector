from __future__ import annotations
from pathlib import Path
from .model import stable_digest
from .profile import PRUNE_DIRECTORIES,profile_repository
from .qualification import QualificationPolicy,qualify
from .registry import run_providers
BINARY_EXTENSIONS={'.png','.jpg','.jpeg','.gif','.pdf','.zip','.gz','.woff','.woff2','.ttf','.otf','.wasm','.bin','.exe','.dll','.so'}
def _read_git_text(path):
 try:return path.read_text(encoding='utf-8').strip()
 except OSError:return None
def git_head(root):
 git_dir=Path(root)/'.git'
 head=_read_git_text(git_dir/'HEAD')
 if head is None:return 'UNKNOWN'
 if not head.startswith('ref:'):return head or 'UNKNOWN'
 ref=head[4:].strip()
 direct=_read_git_text(git_dir/ref)
 if direct:return direct
 packed=_read_git_text(git_dir/'packed-refs')
 if packed:
  for line in packed.splitlines():
   line=line.strip()
   if not line or line[0] in '#^':continue
   parts=line.split(' ',1)
   if len(parts)==2 and parts[1]==ref:return parts[0]
 return 'UNKNOWN'
def classify_files(root):
 c={'supported_text':0,'supported_binary':0,'ignored':0,'unreadable':0,'oversized':0}
 for p in sorted(root.rglob('*')):
  rel=p.relative_to(root)
  if any(x in PRUNE_DIRECTORIES for x in rel.parts):c['ignored']+=1;continue
  if not p.is_file():continue
  try:size=p.stat().st_size
  except OSError:c['unreadable']+=1;continue
  if size>1500000:c['oversized']+=1;continue
  if p.suffix.lower() in BINARY_EXTENSIONS:c['supported_binary']+=1;continue
  try:p.read_text(encoding='utf-8')
  except UnicodeDecodeError:c['supported_binary']+=1
  except OSError:c['unreadable']+=1
  else:c['supported_text']+=1
 return c
def audit_repository(root:Path,*,policy=None):
 root=root.resolve();profile=profile_repository(root);obs,failures,providers=run_providers(root,profile);effective=policy or QualificationPolicy();findings=qualify(obs,effective);classes=classify_files(root);outcome='complete' if not failures and not classes['unreadable'] and not classes['oversized'] else 'partial'
 result={'schema_version':'l9.node-typescript-audit.v1','base_ref':git_head(root),'repository_profile':profile.to_dict(),'ecosystems':[profile.ecosystem],'languages':list(profile.languages),'providers_executed':providers,'file_classification':classes,'provider_failures':[f.to_dict() for f in failures],'outcome':outcome,'observation_count':len(obs),'qualified_finding_count':len(findings),'observations':[o.to_dict() for o in obs],'findings':[o.to_finding() for o in findings],'qualification_policy':{'minimum_confidence':effective.minimum_confidence,'minimum_severity':effective.minimum_severity,'enabled_provider_families':list(effective.enabled_provider_families),'suppressed_rules':list(effective.suppressed_rules)}};result['audit_fingerprint']=stable_digest(result);return result
