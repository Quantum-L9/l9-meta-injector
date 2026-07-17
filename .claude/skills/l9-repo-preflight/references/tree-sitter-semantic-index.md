# Tree-sitter semantic index

## Purpose

Build one cross-language structural index immediately after environment detection and before repository profiling. Reuse the index in capability inference, Gates 9-20, contradiction analysis, Gate 20 synthesis, change-impact analysis, and agent context selection.

## Providers

- Python: native `ast` is authoritative for deep Python facts. Tree-sitter Python is an optional structural fallback.
- JavaScript and TypeScript: Tree-sitter structural parsing.
- Bash: Tree-sitter structural parsing.
- YAML and JSON: existing structured loaders.

Install optional grammars with `python -m pip install -r requirements-tree-sitter.txt`.

## Normalized facts

The index emits symbols, imports, exports, calls, routes, fields, and error handlers with language, native node type, source byte and line ranges, parser provider, runtime version, and grammar version.

## Authority and limitations

Tree-sitter proves syntax structure, not runtime behavior, dynamic dispatch, dependency-injection resolution, reflection, generated code execution, or complete data flow. Preserve parser errors and partial trees as evidence limitations. Never upgrade partial or unavailable parsing to clear.

## Upstream use

Use the index before classification to identify executable entrypoints, public APIs, service routes, exported contracts, package shape, and actual cross-file relationships. Use it to compile smaller context bundles and evidence-backed change-impact maps.

## Downstream use

Use the same facts for wiring detection, dormant capability checks, drift, cross-component contracts, CI shell semantics, security and data-safety gates, prompt-tool validation, test selection, PR semantic diffing, and bounded tree-aware remediation.
