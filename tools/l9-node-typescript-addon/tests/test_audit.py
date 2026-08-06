from pathlib import Path
from l9_node_ts.audit import audit_repository
def test_node_typescript_findings_are_qualified(tmp_path:Path):
 (tmp_path/'package.json').write_text('{"name":"example","packageManager":"pnpm@10.0.0","dependencies":{"left-pad":"*"},"devDependencies":{"left-pad":"^1.3.0"}}');(tmp_path/'pnpm-lock.yaml').write_text("lockfileVersion: '9.0'\n");(tmp_path/'tsconfig.json').write_text('{//comment\n"compilerOptions":{"strict":false,},}');(tmp_path/'src').mkdir();(tmp_path/'src/index.ts').write_text("export const token=eval('value');\n");(tmp_path/'asset.png').write_bytes(b'\x89PNG\r\n\x1a\n')
 r=audit_repository(tmp_path);ids={f['rule_id'] for f in r['findings']};assert {'strict-mode-disabled','duplicate-dependency-section','mutable-dependency-version','eval-usage'}<=ids;assert r['outcome']=='complete';assert r['file_classification']['supported_binary']==1
def test_expected_binary_does_not_make_run_partial(tmp_path:Path):
 (tmp_path/'package.json').write_text('{"name":"example","packageManager":"npm@11"}');(tmp_path/'package-lock.json').write_text('{"lockfileVersion":3}');(tmp_path/'logo.png').write_bytes(b'\x89PNG\r\n\x1a\n');assert audit_repository(tmp_path)['outcome']=='complete'
