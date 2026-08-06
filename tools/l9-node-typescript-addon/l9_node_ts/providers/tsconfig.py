from pathlib import Path
from ..jsonc import load,JsoncError
from ..model import Location,Observation
class TypeScriptConfigProvider:
 provider_id='typescript.config'
 def applicable(self,profile):return profile.typescript
 def analyze(self,root:Path,profile):
  out=[]
  if not profile.tsconfig_paths:return [Observation(self.provider_id,'missing-tsconfig','correctness','high',1.0,profile.package_json_paths[0],'TypeScript sources exist but no tsconfig file was detected','compiler behavior is implicit and can differ between tools','add a repository-owned tsconfig.json with explicit compiler settings',Location(1),{'typescript':True,'tsconfig_count':0},('tsconfig.json',),True,leverage_score=4.5)]
  for rel in profile.tsconfig_paths:
   try:cfg=load(root/rel)
   except Exception as exc:out.append(Observation(self.provider_id,'invalid-tsconfig','correctness','high',1.0,rel,'TypeScript configuration is not valid JSONC','the compiler cannot reliably load the project configuration','repair the TypeScript configuration syntax',Location(1),{'error':str(exc)},(rel,),True,leverage_score=4.5));continue
   opts=cfg.get('compilerOptions',{}) if isinstance(cfg,dict) else {}
   if not isinstance(opts,dict):opts={}
   if opts.get('strict') is not True:out.append(self.opt(rel,'strict-mode-disabled','high','TypeScript strict mode is not explicitly enabled','unsafe implicit types and nullable values can cross module boundaries','enable compilerOptions.strict and resolve the resulting type errors',{'compiler_option':'strict','actual':opts.get('strict'),'expected':True},4.6))
   if opts.get('noImplicitAny') is False:out.append(self.opt(rel,'implicit-any-enabled','high','TypeScript explicitly permits implicit any values','untyped values bypass static contract checking','remove the override or enable noImplicitAny',{'compiler_option':'noImplicitAny','actual':False,'expected':True},4.3))
   if opts.get('sourceMap') is True and opts.get('inlineSources') is True:out.append(self.opt(rel,'inline-production-sources','medium','source maps embed original source content','published artifacts may disclose implementation source','disable inlineSources for public or production builds',{'compiler_option':'inlineSources','actual':True,'expected':False},3.2))
  return out
 def opt(self,path,rule,sev,msg,impact,correction,evidence,score):return Observation(self.provider_id,rule,'correctness',sev,.99,path,msg,impact,correction,Location(1),evidence,(path,),sev=='high',leverage_score=score)
