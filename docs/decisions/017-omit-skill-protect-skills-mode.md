# ADR-017: Omit layer, SKILL.md protect, and Cursor-native skills mode

## Status

Accepted

## Date

2026-07-31

## Context

Inventory and pipeline would mutate Cursor `SKILL.md` entrypoints with L9 identity headers, corrupting agent-skill discovery. There was no gitignore-style omit shared across modes (inventory had dirname-only `--ignore`). Operators also need a dedicated path to materially improve Cursor skill `description` fields (including “Use when …” trigger language) without inventing a non-Cursor `triggers:` key.

## Options Considered

### Option A: Special-case `SKILL.md` only inside injectFile

- Pros: tiny change.
- Cons: inventory sidecars and other paths still mutate; no operator omit API; no skills improvement path.

### Option B: Parse consumer `.gitignore` as the omit source

- Pros: familiar.
- Cons: conflates VCS ignore with metadata-injection policy; surprising exclusions.

### Option C: Shared `.l9metaignore` + built-in protect + dedicated `skills` mode (Cursor-native)

- Pros: clear separation; inventory/pipeline never mutate `SKILL.md`; skills mode material-improves `description` and optionally fills L9 `activation_signals`.
- Cons: another config surface and public API export.

## Decision

We choose **Option C**.

1. Built-in omit always skips bytecode/log noise and (for inventory/pipeline) protects `SKILL.md` / `skill.md`.
2. Optional `.l9metaignore`, `--omit`, and `--omit-file` extend the matcher (gitignore syntax; not the repo’s `.gitignore`).
3. New `runSkillsPipelineAsync` / `npm run skills` / Action `mode: skills` may touch skill artifacts only, writing Cursor frontmatter solely when material diffs exist. Primary field: `description`. Optional: `activation_signals`. No Cursor `triggers:` key. No L9 identity stamps into skill frontmatter.

## Consequences

- Inventory/pipeline callers get SKILL.md protection by default.
- Skills improvement requires the explicit skills mode (and usually `--llm`).
- Public API gains `runSkillsPipelineAsync` and related types; advanced exports omit helpers.
