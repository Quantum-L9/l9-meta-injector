# v3.9 change traceability

| Requirement | Implementation | Validation |
|---|---|---|
| Integrate as high upstream as possible | `v39.run` builds semantic index after environment detection and before profiling/gates | `test_v39_identity`, full regression suite |
| Cross-language parsing | `syntax/tree_sitter_runtime.py`, `tree_sitter_index.py` | cross-language fixture test |
| Preserve Python depth | native `python.ast` facts merged into shared index | legacy Gate 16/17/19 tests |
| Preserve provenance | normalized facts include native node type, ranges, runtime and grammar versions | provenance test |
| Honest absence and parse failures | unavailable grammars and error nodes become limitations | unavailable and malformed fixtures |
| Downstream reuse | Gates 16, 17, and 19 consume shared index; registry capability activation uses routes | integration tests |
| Portable installation | optional pinned runtime plus grammar requirement file | import and runtime tests |
