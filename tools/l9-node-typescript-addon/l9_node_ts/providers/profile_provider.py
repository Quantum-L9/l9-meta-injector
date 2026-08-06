from pathlib import Path
from ..model import Location,Observation
from ..profile import RepositoryProfile
class ProfileProvider:
 provider_id='node.repository-profile'
 def applicable(self,profile):return profile.ecosystem=='node'
 def analyze(self,root:Path,profile:RepositoryProfile):
  out=[]
  if profile.profile_warnings:
   out.append(Observation(self.provider_id,'conflicting-lockfiles','supply-chain','high',1.0,profile.package_json_paths[0],'multiple package-manager lockfiles or conflicting package-manager signals were detected','different environments may install different dependency graphs','select one package manager, remove foreign lockfiles, and regenerate the canonical lockfile',Location(1),{'lockfiles':list(profile.lockfiles),'warnings':list(profile.profile_warnings),'package_manager':profile.package_manager},tuple(sorted(set(profile.lockfiles+(profile.package_json_paths[0],)))),True,leverage_score=4.3))
  if profile.package_manager and not profile.lockfiles:
   out.append(Observation(self.provider_id,'missing-lockfile','supply-chain','high',1.0,profile.package_json_paths[0],'the Node.js repository has no committed dependency lockfile','dependency resolution is not reproducible across installations',f'generate and commit the lockfile for {profile.package_manager}',Location(1),{'package_manager':profile.package_manager},(profile.package_json_paths[0],),True,leverage_score=4.4))
  return out
