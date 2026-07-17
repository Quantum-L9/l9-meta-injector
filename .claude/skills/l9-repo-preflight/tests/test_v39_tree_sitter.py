from __future__ import annotations
from pathlib import Path
from preflight.syntax import build_index
from preflight.v39 import run

def test_tree_sitter_builds_cross_language_index(tmp_path:Path)->None:
 (tmp_path/'app.ts').write_text("export function send(packet: Packet) { return client.send(packet); }\n",encoding='utf-8')
 (tmp_path/'health.js').write_text("router.get('/health', healthHandler);\n",encoding='utf-8')
 (tmp_path/'deploy.sh').write_text("#!/bin/bash\npytest || true\n",encoding='utf-8')
 index=build_index(tmp_path)
 assert index['engine']=='hybrid_semantic_index'
 assert any(f['kind']=='symbol' and f['language']=='typescript' for f in index['facts'])
 assert any(f['kind']=='call' and f['language']=='javascript' for f in index['facts'])
 assert any(f['language']=='bash' for f in index['facts'])

def test_source_ranges_and_provenance_are_preserved(tmp_path:Path)->None:
 (tmp_path/'x.ts').write_text('const value = api.fetch(input);\n',encoding='utf-8')
 fact=next(f for f in build_index(tmp_path)['facts'] if f['kind']=='call')
 assert fact['range']['start_line']==1
 assert fact['native_node_type']=='call_expression'
 assert fact['provider']=='tree_sitter'
 assert fact['grammar_version']!='UNKNOWN'

def test_parse_errors_reduce_completeness(tmp_path:Path)->None:
 (tmp_path/'broken.ts').write_text('function broken( {',encoding='utf-8')
 report=run(tmp_path,audit_mode='static_only')
 assert report['semantic_index']['parse_error_count']>0
 assert 'semantic_index_partial_parse' in report['preflight_result']['limitations']
 assert report['full_preflight'] is False

def test_tree_sitter_unavailable_is_honest(tmp_path:Path,monkeypatch)->None:
 import preflight.syntax.tree_sitter_index as module
 class State:
  available=False; version='UNKNOWN'; grammars={'typescript':{'available':False}}; error='missing'
 monkeypatch.setattr(module,'inspect_runtime',lambda:State())
 monkeypatch.setattr(module,'parser_for',lambda language:(None,State()))
 (tmp_path/'x.ts').write_text('const x=1',encoding='utf-8')
 index=module.build_index(tmp_path)
 assert index['files'][0]['parse_status']=='not_observed'
 assert index['files'][0]['provider']=='unavailable'

def test_gate16_uses_typescript_route_evidence(tmp_path:Path)->None:
 (tmp_path/'server.ts').write_text("app.get('/health', handler);\n",encoding='utf-8')
 (tmp_path/'.env.example').write_text('PORT=3000\n',encoding='utf-8')
 report=run(tmp_path,audit_mode='static_only')
 gate=next(g for g in report['extended_gate_results'] if g['gate_id']==16)
 assert gate['applicable'] is True
 assert not any(f['id']=='G16-HEALTH' for f in gate['findings'])

def test_v39_identity(tmp_path:Path)->None:
 report=run(tmp_path,audit_mode='static_only')
 assert report['version']=='3.9'
 assert report['versions']['semantic_index']=='1.0'
