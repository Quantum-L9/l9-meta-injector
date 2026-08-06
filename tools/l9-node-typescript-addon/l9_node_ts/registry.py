from .model import ProviderFailure
from .providers import PackageJsonProvider,ProfileProvider,TypeScriptConfigProvider,TypeScriptSourceProvider
PROVIDERS=(ProfileProvider(),PackageJsonProvider(),TypeScriptConfigProvider(),TypeScriptSourceProvider())
def run_providers(root,profile):
 observations=[];failures=[];executed=[]
 for provider in PROVIDERS:
  if not provider.applicable(profile):continue
  executed.append(provider.provider_id)
  try:observations.extend(provider.analyze(root,profile))
  except Exception as exc:failures.append(ProviderFailure(provider.provider_id,None,f'{type(exc).__name__}: {exc}'))
 observations.sort(key=lambda x:(x.repository_path,x.location.start_line,x.provider_id,x.rule_id,x.observation_id))
 return observations,failures,executed
