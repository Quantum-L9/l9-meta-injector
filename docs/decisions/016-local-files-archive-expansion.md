# ADR-016: Local-files mode expands archives before injection

## Status

Accepted

## Date

2026-07-31

## Context

Default pipeline discovery treats `.zip` (and other archive extensions) as `skip-binary`: they are excluded from scan, never get a sidecar, and members inside the archive are invisible. That is correct for git repos, which almost never store expandable archives as primary content.

Operators also run the injector against disposable local folders (Dropbox trees, desktop packs) where `.zip` files are common carriers of the real artifacts. In that setting, skipping archives silently under-covers the tree.

## Options Considered

### Option A: Always extract archives in the default pipeline

- Pros: one code path; local folders "just work."
- Cons: surprising and unsafe for repos (large trees, Zip-Slip risk, mutating checkouts); breaks the current binary-skip contract relied on by tests and CI.

### Option B: Inventory-only sidecars on the zip, still no member injection

- Pros: small change; zip becomes visible in manifests.
- Cons: does not satisfy the local-files goal of annotating archive members.

### Option C: Opt-in `localFiles` / `--local-files` pre-step that extracts, sidecars the zip, then runs the normal pipeline on members

- Pros: preserves default repo behavior; makes the mutative archive path explicit; reuses existing inject/verify; fail-closed Zip-Slip checks and `unzip` requirement are scoped to the opt-in path.
- Cons: requires system `unzip`; extraction mutates the tree; another config surface to document.

## Decision

We choose **Option C**. `PipelineConfig.localFiles` (CLI: `--local-files`) runs `expandArchivesUnderRoot` before `findFiles`. Each `.zip` is expanded into a sibling `*.l9extracted/` directory, a `<zip>.l9meta.yaml` sidecar is written (unless `dryRun`), nested zips are expanded up to a fixed depth, and extracted members are injected by the existing pipeline. Default mode remains non-extracting.

## Consequences

- Repo / CI callers must not pass `localFiles` unless they intend filesystem mutation via extraction.
- Local-files mode depends on the system `unzip` binary; absence fails closed with an explicit error.
- `--dry-run` still suppresses metadata writes (headers and archive sidecars) but extraction still occurs so member dry-run diffs can be produced against real extracted files.
- Coverage reports `archivesExpanded`; `archives-expanded.json` is written to the index dir on non-dry runs.
- The shared omit layer (ADR-017) applies to archive discovery and member extraction: omitted archives are not expanded, and omitted members (including protected `SKILL.md`) are not written onto disk.
- Further archive formats (`.tar.gz`, etc.) remain out of scope until a follow-up ADR.
