from __future__ import annotations
import re

def analyze(workflows):
 advisory=[]; enforcing=[]
 for wf in workflows:
  text=wf['text']
  if re.search(r'DISABLE_ERRORS\s*:\s*true',text,re.I): advisory.append({'file':wf['path'],'tool':'megalinter','evidence':'DISABLE_ERRORS: true'})
  for tool,pat in [('ruff',r'ruff check'),('mypy',r'mypy'),('pytest',r'pytest'),('actionlint',r'actionlint')]:
   if re.search(pat,text): enforcing.append({'file':wf['path'],'tool':tool})
 covered=bool(enforcing)
 return {'advisory':advisory,'enforcing':enforcing,'status':'clear' if not advisory or covered else 'warning','confidence':0.88 if advisory else 0.99}
