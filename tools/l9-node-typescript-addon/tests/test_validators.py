from pathlib import Path
from l9_node_ts.profile import profile_repository
from l9_node_ts.validators import resolve_validator_plan
def test_resolves_argument_vector_validators(tmp_path:Path):
 (tmp_path/'package.json').write_text('{"name":"example","packageManager":"pnpm@10.0.0","scripts":{"typecheck":"tsc --noEmit","test":"vitest run","build":"tsc"}}');(tmp_path/'pnpm-lock.yaml').write_text("lockfileVersion: '9.0'\n");(tmp_path/'tsconfig.json').write_text('{"compilerOptions":{"strict":true}}');p=profile_repository(tmp_path);plan=resolve_validator_plan(tmp_path,p);assert [c.to_dict() for c in plan.commands]==[{'executable':'pnpm','arguments':['typecheck']},{'executable':'pnpm','arguments':['test']},{'executable':'pnpm','arguments':['build']}]
