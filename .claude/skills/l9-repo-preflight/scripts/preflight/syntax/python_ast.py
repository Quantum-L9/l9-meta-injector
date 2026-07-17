from __future__ import annotations
import ast
from pathlib import Path
from typing import Any

def _name(node: ast.AST)->str:
    if isinstance(node, ast.Name): return node.id
    if isinstance(node, ast.Attribute): return f"{_name(node.value)}.{node.attr}".strip('.')
    return ''

def scan_file(path:Path)->dict[str,Any]:
    try: tree=ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
    except (OSError,UnicodeError,SyntaxError) as exc: return {'path':str(path),'parse_error':str(exc),'definitions':[],'calls':[],'decorators':[],'annotated_fields':[],'imports':[]}
    defs=[]; calls=[]; decorators=[]; fields=[]; imports=[]
    for node in ast.walk(tree):
        if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)):
            defs.append({'name':node.name,'kind':type(node).__name__,'line':node.lineno})
            for dec in getattr(node,'decorator_list',[]): decorators.append({'target':node.name,'name':_name(dec.func if isinstance(dec,ast.Call) else dec),'line':getattr(dec,'lineno',node.lineno),'args':[ast.unparse(a) for a in dec.args] if isinstance(dec,ast.Call) else []})
        elif isinstance(node,ast.Call): calls.append({'name':_name(node.func),'line':node.lineno,'args':[ast.unparse(a) for a in node.args]})
        elif isinstance(node,ast.AnnAssign) and isinstance(node.target,ast.Name): fields.append({'name':node.target.id,'annotation':ast.unparse(node.annotation),'line':node.lineno})
        elif isinstance(node,ast.Import): imports.append({'text':ast.unparse(node),'line':node.lineno})
        elif isinstance(node,ast.ImportFrom): imports.append({'text':ast.unparse(node),'line':node.lineno})
    return {'path':str(path),'parse_error':None,'definitions':defs,'calls':calls,'decorators':decorators,'annotated_fields':fields,'imports':imports}

def scan_repo(repo:Path)->dict[str,Any]:
    files=[]
    for path in sorted(repo.rglob('*.py')):
        if any(p in {'.git','.venv','node_modules','__pycache__','.pytest_cache'} for p in path.relative_to(repo).parts): continue
        item=scan_file(path); item['path']=str(path.relative_to(repo)); files.append(item)
    return {'engine':'python.ast','files':files,'parse_errors':[f for f in files if f['parse_error']]}
