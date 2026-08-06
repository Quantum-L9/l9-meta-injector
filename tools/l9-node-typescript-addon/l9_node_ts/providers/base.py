from __future__ import annotations
from pathlib import Path
from typing import Protocol
from ..model import Observation
from ..profile import RepositoryProfile
class Provider(Protocol):
 provider_id:str
 def applicable(self,profile:RepositoryProfile)->bool:...
 def analyze(self,root:Path,profile:RepositoryProfile)->list[Observation]:...
