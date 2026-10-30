# ADR-074: Action outputs come from the child's own summary line, and output-bound paths refuse NUL/CR/LF

## Status

Accepted

Records a decision already shipped in commit `2a90e11` (WU-065: RC-100 / F-077 and
RC-105 / F-144). Consumes, and does not reopen,
[ADR-022](022-contained-action-and-cli-dispatch.md) (contained Action dispatch) and the
DEC-GAR-04 versioning rule adopted in
[ADR-057](057-comment-carrier-position-detection-and-value-safety.md).

## Date

2026-10-29

## Context

`action.yml` declares five outputs of the `run` step: `scanned`, `injected`
(“zero for inventory/check”), `verification-passed` (“check/apply verification result;
n-a for other modes”), `artifact-path` and `resolved-mode`. `scripts/operation-cli.js`
writes them, plus the internal `upload_artifact`, to `GITHUB_OUTPUT`. Before `2a90e11`
two defects made those values untrustworthy:

- **RC-100 / F-077.** `execute` concatenated the child's stdout and stderr, and
  `parseSummary` scanned that text with unanchored regexes, keeping the **last**
  `scanned=`/`considered=`, the last `injected=`/`changed=` and the last
  `passed=(true|false)` anywhere in it. Repository-influenced text (a drift line, a
  file named `passed=true.md`, a stderr diagnostic) could therefore turn a failing check
  green or change the counts; the skills summary's `unchanged=` count could be reported
  as `injected`; inventory's manifest text was parsed as counts; and a check or apply
  child that printed no summary reported `verification-passed=n-a`.
- **RC-105 / F-144.** Resolved paths (workspace, action path, root, out, `RUNNER_TEMP`,
  check report directory) were not checked for NUL, CR or LF after canonicalisation, and
  `appendOutput` wrote `key=value` unvalidated. A path or value with a line break could
  forge additional `GITHUB_OUTPUT` lines, and a refused value could leave earlier
  outputs already written.

## Options Considered

The decision packet for DEC-RC-100 is not stored in this repository; its option list is
recorded here only as far as the shipped commit states it.

### Status quo (pre-`2a90e11`)

- Pros: no change.
- Cons: the defects above; the `action.yml` output descriptions were not honoured.

### DEC-RC-100 Option B (adopted, “as recommended” per `2a90e11`)

- Pros: outputs derive from one structured record the child itself prints, read from
  stdout only, with the mode fixing every field the mode does not produce.
- Cons: any future change to a child's summary line must change its grammar in
  `scripts/lib/operation-dispatch.js` in the same commit, or the outputs fall back to
  the absent-summary values.

### DEC-GAR-04: versioning (from ADR-057)

- Option A: ship within the maintained `v4` line as a fix with release notes.
- Option B: major release `v5`, warranted only when a documented contract is broken.

## Decision

1. **DEC-RC-100 Option B.** `parseSummary(mode, stdout)` reads only the child's stdout
   (`execute` no longer consults stderr) and accepts the first line that matches the
   mode's whole-line, anchored summary grammar (`SUMMARY_GRAMMARS`):
   - `inventory: N entries (F files, D folders)`
   - `check-cli: scanned=… planned=… drift=… authorityConflicts=… passed=(true|false)`
   - `apply-cli: scanned=… planned=… changed=… inlineChanged=… metadataIndexChanged=… passed=(true|false)`
   - `skills-cli: considered=… changed=… unchanged=… authorityResolved=… repositoryMutated=…`

   The mode fixes the fields it does not produce (`SUMMARY_OUTPUTS`):

   | Mode | `scanned` | `injected` | `verification_passed` | No summary line |
   |---|---|---|---|---|
   | inventory | entries | `0` | `n-a` | `0` / `0` / `n-a` |
   | check | `scanned` | `0` | `passed` | `0` / `0` / `false` |
   | apply | `scanned` | `changed` | `passed` | `0` / `0` / `false` |
   | skills | `considered` | `changed` | `n-a` | `0` / `0` / `n-a` |

   A check or apply child that printed no summary (it crashed) reports
   `verification_passed=false`, never `n-a` or `true`. An unknown mode throws.
2. **RC-105.** `assertResolvedPath` refuses, with `ActionInputError`, any resolved path
   containing NUL, CR or LF; `realDirectory` and `resolveFutureContainedPath` (lexical
   result and the realpath of an existing target) apply it, so every Action and command
   line path is checked before any child runs. `outputLine` refuses a key or value
   containing NUL, CR or LF, and `writeOutputs` validates all six outputs before writing
   any, so a refusal leaves `GITHUB_OUTPUT` untouched and the step exits 2.
3. **DEC-GAR-04 Option A.** The change ships within `v4` as a fix: output values were
   never documented to be scraped from free text, and the change makes the `action.yml`
   output descriptions true. Release itself requires separate authority (INV-023).

## Consequences

- A workflow gating on `verification-passed` sees `false` for a crashed check or apply
  where it previously saw `n-a`; skills `injected` is the changed count; inventory
  `injected` is always `0`. These are corrections to the documented contract, not a
  new one.
- A repository whose resolved root, output or temporary path contains NUL, CR or LF is
  refused before any child runs.
- `scripts/operation-cli.js` runs only as the entry point (`require.main` guard) and
  exports `appendOutput`, `outputLine` and `writeOutputs` for tests; this is not part of
  the package's public API.
- Tests: `tests/action_outputs.test.ts` (`REG-WU-065-RC-100-a` … `-h`,
  `REG-WU-065-RC-105-a` … `-e`).
