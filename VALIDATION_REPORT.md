# Validation Report

## Results
### `npm install`
- Exit code: `0`
- Summary: added 280 packages, and audited 281 packages in 3s; EXIT_CODE=0

### `npm run build`
- Exit code: `0`
- Summary: EXIT_CODE=0

### `npm test`
- Exit code: `0`
- Summary: PASS tests/retrieval_txt.test.ts (12.293 s); PASS tests/assist.test.ts (12.218 s); PASS tests/reconcile_fields.test.ts (12.301 s); PASS tests/reconcile_fields_async.test.ts (12.302 s); PASS tests/pipeline_integration.test.ts (12.604 s); Test Suites: 9 passed, 9 total; Tests:       66 passed, 66 total; EXIT_CODE=0

### `npx jest --runInBand`
- Exit code: `0`
- Summary: PASS tests/llm.test.ts; PASS tests/reconcile_fields_async.test.ts; PASS tests/normalize_filename.test.ts; PASS tests/assist.test.ts; PASS tests/schema.test.ts; Test Suites: 9 passed, 9 total; Tests:       66 passed, 66 total; EXIT_CODE=0

### `npm pack --dry-run`
- Exit code: `0`
- Summary: npm notice Tarball Details; npm notice package size: 50.7 kB; npm notice total files: 71; EXIT_CODE=0

## Hygiene checks
- macOS junk removed: pass
- node_modules excluded from git/package: pass
- basic secrets scan: pass, no matches
- stale external adapter references: pass, none found
- README/package metadata agreement: pass

## Warnings
- `npm install` reported 1 moderate severity dependency vulnerability from the dependency tree. No source change was made because `npm audit fix` can alter dependency versions and was not required by the contract.
- Jest emits a ts-jest deprecation warning about `globals`; tests still pass. This is technical debt, not an initial-commit blocker.

## Repo Structure Normalizer Pass - 2026-07-04

Skill: `repo-structure-normalizer` v1.0.0 from `/mnt/data/l9-repo-structure-normalizer.skill.zip`.

Dry-run result: 20 proposed operations, 0 collisions, 0 blocked operations.

Applied: 13 safe documentation/reference normalizations under `docs/`:

- Uppercase documentation filenames converted to lowercase snake_case.
- `docs/references/reasoning-link.md` -> `docs/references/reasoning_link.md`.
- `docs/references/worked-example.md` -> `docs/references/worked_example.md`.

Rejected/skipped: 7 root-file operations because the previous repo-prep contract required these files to remain at repository root: `CHANGELOG.md`, `LICENSE_NOTE.md`, `MANIFEST.json`, `PACK_INVENTORY.md`, `PACK_INVENTORY.json`, `VALIDATION_REPORT.md`, `INITIAL_COMMIT_REPORT.md`.

Validation after normalizer pass:

- `npm run build`: exit 0
- `npm test`: exit 0; 9 suites, 66 tests passed
- `npx jest --runInBand`: exit 0; 9 suites, 66 tests passed
- `npm pack --dry-run`: exit 0; package generated successfully in dry-run output

Known warnings remain:

- `ts-jest` config deprecation warning.
- npm audit still reports one moderate dependency vulnerability after install.

