from __future__ import annotations
import hashlib, json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Mapping
SEVERITY_RANK={"critical":0,"high":1,"medium":2,"low":3}
def canonical_json(value:Any)->bytes:
 return (json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False)+"\n").encode()
def stable_digest(value:Any)->str:return hashlib.sha256(canonical_json(value)).hexdigest()
def normalize_path(path:Path,root:Path)->str:
 try:return path.resolve().relative_to(root.resolve()).as_posix()
 except ValueError as exc:raise ValueError(f"path escapes repository: {path}") from exc
@dataclass(frozen=True)
class Location:
 start_line:int; start_column:int=1; end_line:int|None=None; end_column:int|None=None
 def to_dict(self):
  d={"start_line":self.start_line,"start_column":self.start_column}
  if self.end_line is not None:d["end_line"]=self.end_line
  if self.end_column is not None:d["end_column"]=self.end_column
  return d
@dataclass(frozen=True)
class Observation:
 provider_id:str; rule_id:str; category:str; severity:str; confidence:float; repository_path:str; message:str; impact:str; correction:str; location:Location; evidence:Mapping[str,Any]=field(default_factory=dict); authorized_paths:tuple[str,...]=(); blocks_release:bool=False; owner_layer:str="sdk"; leverage_score:float=3.0
 def __post_init__(self):
  if self.severity not in SEVERITY_RANK:raise ValueError(f"unsupported severity: {self.severity}")
  if not 0<=self.confidence<=1:raise ValueError("confidence must be between zero and one")
  if not self.repository_path:raise ValueError("repository_path may not be empty")
 @property
 def observation_id(self):return "OBS-"+stable_digest({"provider_id":self.provider_id,"rule_id":self.rule_id,"repository_path":self.repository_path,"location":self.location.to_dict(),"evidence":dict(self.evidence)})[:20].upper()
 def to_dict(self):return {"schema_version":"l9.observation.v1","observation_id":self.observation_id,"provider_id":self.provider_id,"rule_id":self.rule_id,"category":self.category,"severity":self.severity,"confidence":self.confidence,"repository_path":self.repository_path,"location":self.location.to_dict(),"message":self.message,"impact":self.impact,"correction":self.correction,"evidence":dict(self.evidence),"remediation_hint":{"authorized_paths":list(self.authorized_paths or (self.repository_path,)),"summary":self.correction},"blocks_release":self.blocks_release,"owner_layer":self.owner_layer,"leverage_score":self.leverage_score}
 def to_finding(self):return {"id":self.observation_id,"rule_id":self.rule_id,"provider_id":self.provider_id,"severity":self.severity,"confidence":self.confidence,"category":self.category,"rule_broken":self.message,"evidence":f"{self.repository_path}:{self.location.start_line}","evidence_detail":dict(self.evidence),"impact":self.impact,"correction":self.correction,"owner_layer":self.owner_layer,"blocks_release":self.blocks_release,"leverage_score":self.leverage_score,"authorized_paths":list(self.authorized_paths or (self.repository_path,)),"source_observation_id":self.observation_id}
@dataclass(frozen=True)
class ProviderFailure:
 provider_id:str; path:str|None; reason:str
 def to_dict(self):return asdict(self)
