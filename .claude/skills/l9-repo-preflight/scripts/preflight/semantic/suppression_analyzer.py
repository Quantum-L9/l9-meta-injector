from __future__ import annotations
from .shell_command_classifier import classify

def analyze(workflows):
 out=[]
 for wf in workflows:
  for i,line in enumerate(wf['text'].splitlines(),1):
   if '|| true' in line:
    c=classify(line.strip()); out.append({'file':wf['path'],'line':i,**c,'status':'blocker' if c['kind']=='validation' else ('warning' if c['kind']=='cleanup' else 'requires_human_review')})
   if 'continue-on-error: true' in line.lower(): out.append({'file':wf['path'],'line':i,'command':'continue-on-error: true','kind':'job-suppression','confidence':0.95,'status':'requires_human_review'})
 return out
