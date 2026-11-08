# Brief — Architecture Statement Coverage Closure (receipt)

Status snapshot for reader `architecture-statements/v1` 1.1.0 (ADR-089, Proposed),
amending the reader of ADR-087. Authority for the supported-input definition is
[`docs/architecture-statement-coverage.md`](../architecture-statement-coverage.md) and its
machine form [`docs/architecture-statement-coverage.json`](../architecture-statement-coverage.json).

## Revision binding

| Item | Value |
|---|---|
| Base | `075c4ef22f6bcc647985bde088c89eb22f0f6bd5` — the merge of PR #140 into #139's head branch. #140 never reached `main` (it merged into `claude-mobile/dazzling-feynman-azm517` after #139 had merged); this stack sits on a recovery branch carrying it unchanged (`claude-mobile/wizardly-edison-p5du91-land-140`) |
| `main` at the time | `a6145334df2f` (merge of #139) |
| Branch | `claude-mobile/wizardly-edison-p5du91-statements` |
| Implementation commit | `b9dafef` |
| Validation report | green at `b9dafef`, then bound to `ec1d48b`; re-bound once more to the commit carrying this brief |
| Merge state | unmerged; no release, no admission |

## Policy identities

| Identity | 1.0.0 (base) | 1.1.0 (this PR) |
|---|---|---|
| extractor id | `architecture-statements/v1` | `architecture-statements/v1` (unchanged: hashed into `evidence_id`) |
| extractor version | 1.0.0 | 1.1.0 |
| projection profile version | 1.0.0 | 1.1.0 |
| profile hash | `sha256:a26e25cb6fca6e16d620a3b7e9f433cd1da6514a0e93417f2b405b456b8409f8` | `sha256:f85cc77f085782ecb0b53cba047cf1fa56f78821d8cd19aa1d20b855caed9b80` |
| record schema | `l9.architecture-evidence/v1` | `l9.architecture-evidence/v1` (additive `continuation_block_ids`) |
| coverage matrix | — | `l9.architecture-statement-coverage/v1`, 37 cases |

Unchanged: the five statement classes, the label vocabulary, the three recognition
forms, every decoder, the interpretation profile, packet identities, the work-signal
payload, every cache layer, and every identity of a run that does not pass
`--architecture-evidence`.

## Changed code

| File | Change |
|---|---|
| `src/extractors/architecture_statements.ts` | heading grammar (section number, one qualifier, setext), lazy and soft-break continuation, frontmatter YAML scalars, thematic-break and code-span exclusions, three new diagnostics, `unit_end_index` / `continuation_blocks` on drafts, locator ending on the last line, rules object extended |
| `src/extractors/work_intelligence.ts` | exports `readFrontmatterLine` and the frontmatter delimiters/bound it already used; behaviour and version unchanged |
| `src/corpus_architecture_evidence.ts` | `continuation_block_ids` on records; locator from the extended draft; profile 1.1.0 |
| `tests/architecture_statement_coverage.test.ts`, `tests/helpers/architecture_coverage.ts` | the matrix, run through `runCorpusScan` over real files with source-coordinate verification |
| `tests/helpers/document_fixtures.ts` | a `\n` in docx fixture text is a Word soft break (`<w:br/>`) |
| `dist/` | rebuilt from `src/` |
| docs | ADR-089, decision log, ADR index, CHANGELOG, `architecture-evidence.md`, the coverage matrix (`.json` + `.md`), architecture manifest regenerated |

## Behaviour comparison on an actual generated corpus

This repository's `docs/` tree at `075c4ef` (148 decoded documents), copied out and run
through the real CLI under the base and under this branch:

```bash
node scripts/local-source-cli.js --root <copy-of-docs>=docs --out <dir> --no-cache --architecture-evidence
```

| | base (1.0.0) | this PR (1.1.0) |
|---|---|---|
| records | 734 | 528 |
| `evidence_id` preserved | — | 322, text / locator / class byte-identical |
| base records not re-emitted | — | 412 = 411 fragments each inside a same-class 1.1.0 record whose span covers their line + 1 inline-code mention (`` `Decision:` `` in `corpus-intelligence.md:293`) |
| records added | — | 206, all multi-line (the reassembled statements); 0 new single-line records |
| coverage diagnostics | 81 (+8 omitted) | 102 (+8 omitted); +21 `heading_not_recognized` |
| `corpus_source_snapshot_id` | `corpus-source-snapshot:587bcf3d…1838` | identical |
| `corpus_analysis_id` | `corpus-analysis:4fbf302b…0328` | `corpus-analysis:2c682bc7…5a01` (profile hash) |

Example (ADR-016 lines 39–40): base emitted `one run-scoped ArchiveExecutionResolution
supplies the policy and` (L39) and, separately, `` `ArchiveSessionBudget` across top-level
and nested archives; `` (L40, a whole-paragraph "decision"). 1.1.0 emits one decision at
L39–40 with `continuation_block_ids` naming the L40 block.

Probe corpus (scratch, mirrored by matrix cases S07–S16): before, `## 1. Constraints`,
`### 2.1 Open Questions`, `## A. Decisions`, `## Assumptions (v2)` and a setext
`Constraints` emitted nothing; frontmatter `objective: |` emitted `|`; an `Assumptions:`
list under `## Constraints` emitted its second item as a *constraint*. After, each is as
the matrix rows state.

## Validation run

| Command | Result |
|---|---|
| `npm run lint` | pass |
| `npm run validate` (tsc, Vitest — including the 40 matrix tests and the 22 existing architecture-evidence tests — public API, architecture authority, manifest, dist parity, selfpack, packed consumer, release candidate) | pass, recorded in `CURRENT_VALIDATION_REPORT.md` |
| `git status --porcelain --untracked-files=all` | empty after each commit |

## Remaining gaps (stated, not claimed)

Tables in any format; a heading naming two labels or a label inside a longer phrase
(reported); frontmatter flow collections and blank-line-split block scalars (reported);
bare `Questions` (excluded by design); unlabelled prose (no inference); a lazy
continuation line that carries a label (keeps its own meaning); formats other than
Markdown/text and Word have no matrix case of their own.

## Publication

Not published from this session. The governance publish gate's local `ci-parity` Biome
lane blocks this ESLint-owned repository's files (it equally blocks
`src/corpus_architecture_evidence.ts`, which real `Analyze (central Core)` passed on #139),
and disabling that lane was refused in this session as a CI bypass. Publication awaits the
operator's decision.
