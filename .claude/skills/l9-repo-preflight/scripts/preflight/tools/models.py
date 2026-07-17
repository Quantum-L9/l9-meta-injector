from dataclasses import asdict, dataclass
@dataclass(frozen=True)
class ToolCapability:
    tool:str; capability:str; provider_type:str; availability:str; reason:str; version:str='UNKNOWN'; execution_supported:bool=False
    def as_dict(self): return asdict(self)
