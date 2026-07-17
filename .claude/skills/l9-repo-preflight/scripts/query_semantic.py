#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from preflight.intelligence import SemanticQueryEngine, build_module_graph


def main() -> int:
    parser = argparse.ArgumentParser(description='Query an L9 semantic snapshot')
    parser.add_argument('snapshot')
    parser.add_argument('--graph')
    sub = parser.add_subparsers(dest='operation', required=True)
    symbols = sub.add_parser('find-symbols')
    symbols.add_argument('--name')
    symbols.add_argument('--kind')
    symbols.add_argument('--scope')
    routes = sub.add_parser('find-routes')
    routes.add_argument('--method')
    routes.add_argument('--path')
    importers = sub.add_parser('find-importers')
    importers.add_argument('module_path')
    fact = sub.add_parser('get-fact')
    fact.add_argument('fact_id')
    args = parser.parse_args()
    snapshot = json.loads(Path(args.snapshot).read_text(encoding='utf-8'))
    graph = json.loads(Path(args.graph).read_text(encoding='utf-8')) if args.graph else {'edges': []}
    engine = SemanticQueryEngine(snapshot, graph)
    if args.operation == 'find-symbols':
        result = engine.find_symbols(args.name, args.kind, args.scope)
    elif args.operation == 'find-routes':
        result = engine.find_routes(args.method, args.path)
    elif args.operation == 'find-importers':
        result = engine.find_importers(args.module_path)
    else:
        result = engine.get_fact(args.fact_id)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
