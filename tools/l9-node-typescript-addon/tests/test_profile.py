from pathlib import Path
from l9_node_ts.profile import profile_repository
def test_profiles_pnpm_typescript_repository(tmp_path:Path):
 (tmp_path/'package.json').write_text('{"name":"example","type":"module","packageManager":"pnpm@10.0.0","workspaces":["packages/*"]}')
 (tmp_path/'pnpm-lock.yaml').write_text("lockfileVersion: '9.0'\n");(tmp_path/'tsconfig.json').write_text('{"compilerOptions":{"strict":true}}');(tmp_path/'src').mkdir();(tmp_path/'src/index.ts').write_text('export const value:number=1;\n')
 p=profile_repository(tmp_path);assert p.package_manager=='pnpm' and p.typescript and p.module_system=='esm' and p.workspace
