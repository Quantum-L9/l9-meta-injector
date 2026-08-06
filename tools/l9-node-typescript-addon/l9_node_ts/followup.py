from .audit import audit_repository
from .qualification import QualificationPolicy
def verify_followup(root,*,finding_id,rule_id=None):
 audit=audit_repository(root,policy=QualificationPolicy(0.0,'low'));matching=[f for f in audit['findings'] if f['id']==finding_id or (rule_id is not None and f.get('rule_id')==rule_id)];return {'schema_version':'l9.followup-verification.v1','finding_to_verify':finding_id,'rule_id':rule_id,'verified_status':'unresolved' if matching else 'resolved','matching_findings':matching,'audit_fingerprint':audit['audit_fingerprint'],'audit_outcome':audit['outcome']}
