from dataclasses import dataclass
from .model import SEVERITY_RANK
@dataclass(frozen=True)
class QualificationPolicy:
 minimum_confidence:float=.8;minimum_severity:str='medium';enabled_provider_families:tuple[str,...]=('node','typescript');suppressed_rules:tuple[str,...]=()
 def __post_init__(self):
  if self.minimum_severity not in SEVERITY_RANK:raise ValueError('invalid minimum severity')
def qualify(observations,policy):
 rank=SEVERITY_RANK[policy.minimum_severity]
 out=[o for o in observations if o.confidence>=policy.minimum_confidence and SEVERITY_RANK[o.severity]<=rank and o.rule_id not in policy.suppressed_rules and any(o.provider_id==f or o.provider_id.startswith(f+'.') for f in policy.enabled_provider_families)]
 return sorted(out,key=lambda o:(SEVERITY_RANK[o.severity],-o.leverage_score,o.repository_path,o.location.start_line,o.observation_id))
