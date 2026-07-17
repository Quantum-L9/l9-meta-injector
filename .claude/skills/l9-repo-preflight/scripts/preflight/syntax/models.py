from __future__ import annotations
from dataclasses import asdict, dataclass, field
from typing import Any

@dataclass(frozen=True)
class SourceRange:
    start_line:int; start_column:int; end_line:int; end_column:int; start_byte:int; end_byte:int

@dataclass(frozen=True)
class SemanticFact:
    kind:str; name:str; language:str; path:str; range:SourceRange
    native_node_type:str; provider:str; provider_version:str='UNKNOWN'; grammar_version:str='UNKNOWN'
    receiver:str|None=None; arguments:tuple[str,...]=(); metadata:dict[str,Any]=field(default_factory=dict)
    def as_dict(self)->dict[str,Any]:
        out=asdict(self); out['range']=asdict(self.range); out['arguments']=list(self.arguments); return out
