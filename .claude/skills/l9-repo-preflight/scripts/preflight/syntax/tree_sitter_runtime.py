from __future__ import annotations
import importlib, importlib.metadata
from dataclasses import dataclass
from typing import Any

GRAMMARS={'python':'tree_sitter_python','javascript':'tree_sitter_javascript','typescript':'tree_sitter_typescript','bash':'tree_sitter_bash'}
@dataclass(frozen=True)
class RuntimeState:
    available:bool; version:str; grammars:dict[str,dict[str,Any]]; error:str|None=None

def inspect_runtime()->RuntimeState:
    try:
        ts=importlib.import_module('tree_sitter'); version=importlib.metadata.version('tree-sitter')
    except Exception as exc: return RuntimeState(False,'UNKNOWN',{},type(exc).__name__)
    grammars={}
    for language,module_name in GRAMMARS.items():
        try:
            module=importlib.import_module(module_name); importlib.metadata.version(module_name.replace('_','-'))
            grammars[language]={'available':True,'module':module_name,'version':importlib.metadata.version(module_name.replace('_','-'))}
        except Exception as exc: grammars[language]={'available':False,'module':module_name,'version':'UNKNOWN','error':type(exc).__name__}
    return RuntimeState(True,version,grammars)

def parser_for(language:str):
    state=inspect_runtime()
    if not state.available or not state.grammars.get(language,{}).get('available'): return None,state
    from tree_sitter import Language, Parser
    module=importlib.import_module(GRAMMARS[language])
    capsule=module.language_typescript() if language=='typescript' and hasattr(module,'language_typescript') else module.language()
    return Parser(Language(capsule)),state
