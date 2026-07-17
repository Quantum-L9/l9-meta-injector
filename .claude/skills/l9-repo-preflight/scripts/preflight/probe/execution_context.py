from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Iterable

@dataclass(frozen=True)
class ExecutionContext:
    mode: str
    capabilities: frozenset[str]
    def supports(self, requirements: Iterable[str]) -> bool:
        return set(requirements).issubset(self.capabilities)
    def as_dict(self):
        d=asdict(self); d['capabilities']=sorted(self.capabilities); return d

FILESYSTEM = ExecutionContext('filesystem', frozenset({'repository_read','recursive_tree','executable_worktree','git_state','command_execution','local_imports'}))
CONNECTOR = ExecutionContext('connector', frozenset({'repository_read','selected_file_read','remote_metadata'}))

def establish(mode: str='filesystem', capabilities: Iterable[str]|None=None) -> ExecutionContext:
    base = CONNECTOR if mode=='connector' else FILESYSTEM
    return ExecutionContext(mode, frozenset(capabilities) if capabilities is not None else base.capabilities)
