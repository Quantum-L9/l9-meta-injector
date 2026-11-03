# ADR-078: The repository-model observation honours the target's git ignore files

## Status

Accepted

Operator decision 2026-11-03 (option B below). Amends the observation input of
[ADR-030](030-repository-model-packet-egress.md); no packet shape changes.

## Date

2026-11-03

## Context

`observeRepositoryModel` walks the target tree through `inventoryTree` and derives every
repository-level fact from that one walk: `package_managers` from lockfiles,
`governance_refs`, `adr_refs`, `package.name`, and the artifact records themselves. The
walk honours built-in noise patterns, `.l9metaignore`, `--omit` and `--omit-file`, but
not the target's own `.gitignore` or `.git/info/exclude`.

A file a repository has declared it does not own was therefore reported as a fact about
that repository. Reproduced on this repository: a tool left a git-ignored
`pnpm-lock.yaml` at the root (`.gitignore` lists it), the packet reported
`package_managers: ["npm", "pnpm"]`, and REG-WU-029-RC-033-e failed. Any consumer
repository with a stray ignored lockfile, build output or editor state gets the same
wrong facts, and they propagate to the topology consumer.

## Options Considered

### Option A: Ask git (`git ls-files -co --exclude-standard`)

- Pros: exact git semantics, including nested `.gitignore` files and global excludes.
- Cons: `src/` would gain its first git subprocess dependency (today only
  `scripts/lib/git-binary.js` resolves git); a non-git target, a missing git binary or a
  worktree layout each needs its own fallback path, and the observation would depend on
  process state outside the tree.

### Option B: Reuse the `src/omit.ts` gitignore matcher over the root ignore files

- Pros: one existing, already-tested matcher and dialect (ADR-047, ADR-058); no new
  dependency; identical behaviour for git and non-git targets; operator omit sources keep
  precedence.
- Cons: only the root `.gitignore` and `.git/info/exclude` are read; nested `.gitignore`
  files, `core.excludesFile` and a worktree's common-dir exclude are not. The matcher is
  case-insensitive where git is case-sensitive.

## Decision

We choose **Option B**.

1. `buildOmitMatcher` gains `honorGitIgnore`. When true it loads the target root's
   `.gitignore` and `.git/info/exclude` (each optional; absent is empty) before
   `.l9metaignore`, `--omit-file` and `--omit`, so an operator source still has the last
   word. A present ignore file that is a symlink, not a regular file, or not valid UTF-8
   fails closed, as every other omit source does.
2. `inventoryTree` passes the option through; `observeRepositoryModel` sets it. Inventory,
   check, apply and skills discovery are unchanged: their governed carrier planning is not
   in scope of this decision.
3. Omitted paths are already counted in the packet's `paths-omitted` notice, so the
   exclusion stays visible.

## Consequences

- A repository-model packet describes only files the repository owns. REG-WU-078-a pins
  that a git-ignored root lockfile is excluded; REG-WU-078-b pins that a tracked one is
  still reported.
- Bounded gap, accepted: nested `.gitignore` files, `core.excludesFile`, a linked
  worktree's common-dir `info/exclude`, and git's case-sensitivity are not modelled. A
  target needing them adds the patterns to `.l9metaignore`.
- Packets for targets whose ignore files match previously observed paths change once:
  those artifacts and facts disappear and `paths-omitted` grows. Consumers comparing
  packets across this release see that delta.
