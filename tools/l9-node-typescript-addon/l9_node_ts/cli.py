from __future__ import annotations
import argparse,json,sys
from pathlib import Path
from .audit import audit_repository
from .followup import verify_followup
from .profile import profile_repository
from .qualification import QualificationPolicy
from .validators import resolve_validator_plan
def write_json(value,output):
 text=json.dumps(value,indent=2,sort_keys=True,ensure_ascii=False)+'\n'
 if output:output.parent.mkdir(parents=True,exist_ok=True);output.write_text(text,encoding='utf-8')
 else:sys.stdout.write(text)
def profile_main(argv=None):
 p=argparse.ArgumentParser();p.add_argument('repository',type=Path);p.add_argument('--output',type=Path);a=p.parse_args(argv)
 try:write_json(profile_repository(a.repository).to_dict(),a.output);return 0
 except Exception as exc:sys.stderr.write(f'profile_rejected:{exc}\n');return 2
def audit_main(argv=None):
 p=argparse.ArgumentParser();p.add_argument('repository',type=Path);p.add_argument('--output',type=Path);p.add_argument('--minimum-confidence',type=float,default=.8);p.add_argument('--minimum-severity',choices=('critical','high','medium','low'),default='medium');p.add_argument('--suppress-rule',action='append',default=[]);a=p.parse_args(argv)
 try:r=audit_repository(a.repository,policy=QualificationPolicy(a.minimum_confidence,a.minimum_severity,suppressed_rules=tuple(a.suppress_rule)));write_json(r,a.output);return 0 if r['outcome']=='complete' else 1
 except Exception as exc:sys.stderr.write(f'audit_rejected:{exc}\n');return 2
def validator_main(argv=None):
 p=argparse.ArgumentParser();p.add_argument('repository',type=Path);p.add_argument('--output',type=Path);a=p.parse_args(argv)
 try:profile=profile_repository(a.repository);write_json(resolve_validator_plan(a.repository.resolve(),profile).to_dict(),a.output);return 0
 except Exception as exc:sys.stderr.write(f'validator_rejected:{exc}\n');return 2
def followup_main(argv=None):
 p=argparse.ArgumentParser();p.add_argument('repository',type=Path);p.add_argument('--finding-id',required=True);p.add_argument('--rule-id');p.add_argument('--output',type=Path);a=p.parse_args(argv)
 try:r=verify_followup(a.repository,finding_id=a.finding_id,rule_id=a.rule_id);write_json(r,a.output);return 0 if r['verified_status']=='resolved' else 1
 except Exception as exc:sys.stderr.write(f'followup_rejected:{exc}\n');return 2
