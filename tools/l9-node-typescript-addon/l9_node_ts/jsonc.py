from __future__ import annotations
import json
from pathlib import Path
from typing import Any
class JsoncError(ValueError):pass
def strip_json_comments(text:str)->str:
 out=[];i=0;ins=False;esc=False
 while i<len(text):
  c=text[i]
  if ins:
   out.append(c)
   if esc:esc=False
   elif c=="\\":esc=True
   elif c=='"':ins=False
   i+=1;continue
  if c=='"':ins=True;out.append(c);i+=1;continue
  if c=='/' and i+1<len(text) and text[i+1]=='/':
   i+=2
   while i<len(text) and text[i] not in '\r\n':i+=1
   continue
  if c=='/' and i+1<len(text) and text[i+1]=='*':
   i+=2
   while i+1<len(text) and text[i:i+2]!='*/':
    if text[i] in '\r\n':out.append(text[i])
    i+=1
   if i+1>=len(text):raise JsoncError('unterminated block comment')
   i+=2;continue
  out.append(c);i+=1
 return ''.join(out)
def remove_trailing_commas(text:str)->str:
 out=[];i=0;ins=False;esc=False
 while i<len(text):
  c=text[i]
  if ins:
   out.append(c)
   if esc:esc=False
   elif c=='\\':esc=True
   elif c=='"':ins=False
   i+=1;continue
  if c=='"':ins=True;out.append(c);i+=1;continue
  if c==',':
   j=i+1
   while j<len(text) and text[j].isspace():j+=1
   if j<len(text) and text[j] in '}]':i+=1;continue
  out.append(c);i+=1
 return ''.join(out)
def loads(text:str)->Any:
 try:return json.loads(remove_trailing_commas(strip_json_comments(text)))
 except json.JSONDecodeError as exc:raise JsoncError(str(exc)) from exc
def load(path:Path)->Any:return loads(path.read_text(encoding='utf-8'))
