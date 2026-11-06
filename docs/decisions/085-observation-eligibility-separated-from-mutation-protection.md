# ADR-085: Observation eligibility is separated from mutation protection

## Status

Accepted

## Date

2026-11-06

## Context

The repository-model observation (`observeRepositoryModel`) walks the tree with `inventoryTree` in dry-run mode and no writes. That walk still built its omit matcher with `protectSkillMd: true`, the built-in that keeps Cursor `SKILL.md` entrypoints away from mutating modes. A protected skill entrypoint therefore never entered the inventory from which `interpretRepository()` builds its candidates, and any native header it carried was read nowhere and reported nowhere.

Separately, `native-metadata/v1` decides by path which files can carry a header. `.editorconfig` and `.gitignore` are hash-comment formats the comment layer already supports (`comment.ts` `BASENAME_LINE_COMMENT`), but they were outside the extractor's carrier list and the text decoder's filenames, so their declarations were also read nowhere.

Both gaps make the absence of an assertion look like the absence of metadata. The L9 Semantic Leverage Architecture Decision Pack (decision D1, PR 1) names them as the producer-side cause of unaccounted header fields.

Four decisions were being represented as one omission decision:

| Decision | Meaning | Owner |
|---|---|---|
| Inventory eligibility | Does the file belong to the observation set? | `inventory.ts` |
| Read eligibility | Can its bytes safely be interpreted? | `interpretation.ts` (secret path, size, encoding) |
| Carrier eligibility | Can an extractor interpret this format? | each extractor's `matches` |
| Mutation eligibility | May the injector rewrite the file? | `mutation_policy.ts` |

## Options Considered

### Option A: a new eligibility policy framework

- Pros: one explicit object for all four decisions.
- Cons: duplicates the owners that already exist and widens the change far beyond the defect.

### Option B: an explicit inventory purpose, and two more carrier basenames

- Pros: uses the existing `InventoryConfig`, `OmitMatcher`, secret-path refusal and extractor `matches`. Mirrors the precedent `local_source.ts` already set ("SKILL.md is protected from mutation, not from observation").
- Cons: one more inventory option.

### Option C: drop skill protection whenever `dryRun` is set

- Pros: no new option.
- Cons: `inventory --dry-run` is a preview of an annotating run. A preview listing files the real run omits would be wrong.

## Decision

We choose **Option B**.

1. `InventoryConfig.purpose` is `annotate` (the default, unchanged behaviour) or `observe`. `observe` is write-free: it is refused unless `dryRun` is set and `injectHeaders`, `writeSidecars` and `folderSidecars` are all disabled. Under `observe` the built-in skill-entrypoint protection does not remove `SKILL.md` from the walk.
2. `observeRepositoryModel` walks with `purpose: "observe"`.
3. Nothing else about inventory eligibility changes: built-in noise, `.l9metaignore`, `--omit-file`, `--omit`, git-ignored untracked paths (ADR-078) and the output-directory exclusion all still apply. Read eligibility is unchanged: a secret-candidate path is still never opened. Mutation eligibility is unchanged: `mutation_policy.ts` still makes `SKILL.md` a `central_manifest` carrier outside skills mode.
4. `native-metadata/v1` 1.3.0 recognizes `.editorconfig` and `.gitignore` as carriers, and the text decoder claims them so the corpus scan interprets and caches them too.

## Consequences

- A protected skill entrypoint's declarations reach the Repository Model Packet as source-bound assertions; the file is never modified.
- The observation profile `meta-injector-inventory-observation` moves to 1.1.0 and the interpretation profile to 1.5.0, because what a packet can describe changed. `l9.repository-model` stays 1.1.0; no wire field is added.
- An annotating inventory, `inventory --dry-run`, check, apply and skills mode are unchanged.
- Tests: `tests/observation_eligibility.test.ts` (protected-but-readable, write-free refusal, operator omission and secret refusal while observing, dotfile carriers) and `tests/native_metadata.test.ts` (carrier and decoder coverage).
