from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Callable
@dataclass(frozen=True)
class GitHubEvidenceRequest: repository:str; base_ref:str|None=None; head_ref:str|None=None; pr_number:int|None=None
class GitHubMcpEvidenceProvider:
    def __init__(self, executor:Callable[[GitHubEvidenceRequest],dict[str,Any]]|None=None): self.executor=executor
    def collect(self, request:GitHubEvidenceRequest)->dict[str,Any]:
        if self.executor is None: return {'status':'not_observed','provider':'github_mcp_action_request','request':request.__dict__,'credentials_required':False}
        return self.executor(request)
