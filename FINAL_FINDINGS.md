# Final findings — main convergence contract v1

Contract `l9-meta-injector-main-convergence-v1`, executed against
`origin/main` at `4c28c5708c4ad336cd7eae910b1c6915ea8c5d04`.
Decision record: [ADR-045](docs/decisions/045-archive-execution-and-transactional-materialization.md).
Release vehicle: [v4.0.1-release-plan.json](docs/release/v4.0.1-release-plan.json).

## Findings closed

| # | Finding | Evidence on main (audited) | Resolution |
|---|---|---|---|
| F1 | Validation digest bound to index state, not bytes | `scripts/validation-report.js:104-119` hashed `git ls-files -s` plus porcelain status classes; a second edit of an already-dirty file moved neither | Digest now hashes the actual bytes of every tracked and untracked file; stop-condition test asserts a second dirty edit moves it |
| F2 | EOCD framing gaps: comment-to-EOF and multi-disk not rejected | `src/zip_reader.ts:161` returned the last signature and stopped | `locateEocd` requires the comment to reach exactly EOF and rejects non-zero disk fields / mismatched on-disk counts |
| F3 | No shared execution context; extractZip hard-coded depth 0 | `src/archives.ts:194` preflighted at `depth: 0`; policy resolved independently in `local_source.ts` | `src/archive_execution.ts` — `ArchiveExecutionContext` + `resolveArchiveExecution` are the single admission/resolution point for both paths; real depth flows from the caller |
| F4 | In-place destructive materialization; marker before members | `src/archives.ts:213-215` rmSync'd the live target then wrote the marker before the member loop | Same-directory candidate, marker after every member is verified, atomic swap with backup-and-restore; mid-write CRC failure leaves the previous extraction byte-identical |
| F5 | Prefix-matched ownership; empty unmarked dirs replaceable | `src/local_source.ts:373` accepted `owner.startsWith("l9-meta-injector.")`; empty dir returned null refusal | v2 marker schema (exact owner + archive sha256 + created_at); destructive authority requires exact v2; empty unmarked and legacy v1 targets refused as user data |
| F6 | Dry-run did not run admission | `src/archives.ts:416-429` returned "would extract" without preflight or the ownership refusal | Dry-run constructs the same context and reports the identical refusal/hold text as a real run, still with zero mutation |

## Findings surfaced during execution (rule 42 — in scope the moment identified)

| # | Finding | Resolution |
|---|---|---|
| F7 | Suite flake under parallel load: four heavy corpus tests exceed Vitest's 5s default, and full worker parallelism starves the worker RPC into an unhandled timeout; both pass in isolation | `vitest.config.ts`: suite timeout budget raised to 30s, workers capped at half machine parallelism; no test weakened, no skip added |
| F8 | `validate:report` regenerating runs require committed `dist/` and a current architecture manifest | Regenerated and committed `dist/` and `docs/architecture-manifest.json` alongside source changes |

## What remains out of scope

- Corpus-intelligence work (#88) — declared out of scope by the contract.
- Package version stays 4.0.0 until the v4.0.1 release plan executes.
- Merge authority: `/l9-pr-remediation`, not this workstream.
