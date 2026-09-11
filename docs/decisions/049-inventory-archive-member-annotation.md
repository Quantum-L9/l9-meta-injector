# ADR-049: Inventory-only archive member annotation, always-sidecar, and Darwin search projection

## Status

Accepted

Amends [ADR-046](046-archive-format-authority-and-fidelity-of-direct-mutation.md): TAR remains
outside **observation expansion**. Inventory annotation may open admitted ZIP and TAR
containers solely to upsert a root `.l9meta.yaml` member.

Does not amend [ADR-036](036-read-only-local-source-acquisition.md): `local-source` stays
read-only and ZIP-only for expansion. Does not amend apply, check, or skills.

## Date

2026-09-11

## Context

Drive / folder inventory (`npm run inventory`) annotates files that are not a Git
repository and must not require `.l9/meta-authority.yaml`. Operators need metadata
to travel **with** archives (zip, tar, tar.gz), not only in `inventory.json`.
Adjacent sidecars were an interim carrier; Finder Get Info Comments stayed empty, so
Spotlight and iCloud/iOS Files search could use only the filename.

ADR-046 left TAR unopened and forbade treating writers as a second observation engine.
`src/archive_preflight.ts` judges ZIP central directories only. `EXPANDABLE_ARCHIVE_EXTENSIONS`
is ZIP-only. Those observation facts must stay true.

Inventory records currently stamp `created_at` with scan time and smash
`created_or_detected_at` onto headers. Operators need three distinct clocks:
filesystem birth, filesystem mtime, and this inspection.

## Options Considered

### Option A: Repo apply / authority file on the drive tree

- Pros: Reuses the governed mutation path.
- Cons: Requires `.l9/meta-authority.yaml` and Git-shaped authority. The operator
  rejected treating a drive corpus as a repository.

### Option B: Adjacent sidecar only (no archive rewrite)

- Pros: Never opens ZIP/TAR; already implemented as an interim.
- Cons: Meta does not travel inside the container; Get Info Comments stay empty;
  a copied zip loses the sidecar if the sibling is not copied.

### Option C: Inventory-owned container pipeline plus always-sidecar plus Darwin projection

- Pros: Inside-member travels with the archive; sidecar stays visible beside it;
  Comments/Tags help Spotlight and iCloud Files; apply/local-source unchanged.
- Cons: Live inventory rewrites archive bytes when `inspected_at` changes; TAR
  rewrite needs its own admit, not ZIP preflight; Zip64/jar/war/bare `.gz` must hold.

## Decision

We choose **Option C**.

1. **Inventory is the only writer.** `src/inventory.ts` owns harvest-first annotation,
   three clocks, adjacent sidecars, in-archive members, and Darwin search xattrs.
   Apply, check, skills, `local-source`, and `localFiles` must not import the writers.

2. **Observation expansion stays ZIP-only.** Do not add `.tar` / `.tgz` / `.gz` to
   `EXPANDABLE_ARCHIVE_EXTENSIONS`. Inventory rewrite uses a separate admit set:
   `.zip`, `.tar`, `.tgz`, and the suffix `.tar.gz`. `.jar`, `.war`, and bare `.gz` hold.

3. **One orchestrator** (`src/inventory_archive_member.ts`):
   `admit → open container → upsert root .l9meta.yaml → write container → atomic replace`.
   ZIP copies existing member compressed blobs as-is. `.tar.gz` inflates, injects a
   TAR member, and deflates. Admit is format-specific: ZIP keeps `archive_preflight`;
   TAR uses the same path-safety predicates on tar names.

4. **Two L9 carriers on every recognized archive:** adjacent `<archive>.l9meta.yaml`
   always; inside-member `.l9meta.yaml` when admit succeeds. Hold writes sidecar only.

5. **Darwin search is a derived projection**, not an L9 source of truth. Finder
   Comment (`kMDItemFinderComment`) and Tags (`_kMDItemUserTags`) use an allowlist.
   Fail-soft off Darwin. Do not rename files. Do not write a ZIP EOCD comment.

6. **`InventoryRecord.created_at` means filesystem birthtime** when the OS has one,
   else unknown. `inspected_at` is this inventory run. Stop emitting
   `created_or_detected_at` on inventory headers, sidecars, and archive members.
   The v3 `BaseHeader` field remains for apply.

## Consequences

- A second live inventory updates `inspected_at` and therefore the archive content hash.
- Zip64 archives hold until a writer can emit Zip64.
- Hostile TAR shapes continue to be refused for rewrite; they still receive a sidecar.
- Public inventory contract changes: `created_at` meaning and new `inspected_at`.
- Architecture authority must name the inventory archive-member owner without changing
  `archive_formats_expanded: ["zip"]`.
