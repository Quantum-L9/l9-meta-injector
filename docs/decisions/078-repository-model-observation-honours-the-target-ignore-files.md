# ADR-078: The repository-model observation omits what git ignores, never what git tracks

## Status

Accepted

Operator decision 2026-11-03: option A below. An earlier draft in the same change
(#118) selected option B; review showed B drops tracked files and was replaced before
merge. Amends the observation input of [ADR-030](030-repository-model-packet-egress.md);
no packet shape changes.

## Date

2026-11-03

## Context

`observeRepositoryModel` walks the target tree through `inventoryTree` and derives every
repository-level fact from that one walk: `package_managers` from lockfiles,
`governance_refs`, `adr_refs`, `package.name`, and the artifact records themselves. The
walk honours built-in noise patterns, `.l9metaignore`, `--omit` and `--omit-file`, but
not git's ignore rules.

A file a repository has declared it does not own was therefore reported as a fact about
that repository. Reproduced on this repository: a tool left a git-ignored
`pnpm-lock.yaml` at the root (`.gitignore` lists it), the packet reported
`package_managers: ["npm", "pnpm"]`, and REG-WU-029-RC-033-e failed. Any consumer with a
stray ignored lockfile, build output or editor state gets the same wrong facts, and they
propagate to the topology consumer.

Git ignore rules apply only to **untracked** files: a tracked or force-added file that
matches `.gitignore` is still the repository's. Tracked-but-ignored files are common —
measured 2026-11-03: 6 in this repository (its own `.l9/meta-authority.yaml` and
`.l9/ci.json` match a bootstrap-written `.git/info/exclude`), 86 in IB-Odoo_19, 9 in
l9-constellation-topology.

## Options Considered

### Option A: Ask git for the untracked, ignored set

`git ls-files --others --ignored --exclude-standard --directory -z`, run in the target.

- Pros: exactly git's semantics — tracked files are never excluded; nested
  `.gitignore`, `.git/info/exclude`, `core.excludesFile` and linked worktrees all apply;
  identical on every machine with the same repository state.
- Cons: `src/` gains a git subprocess (resolved to an absolute path, WU-069).

### Option B: Evaluate the root ignore files with the `src/omit.ts` matcher

- Pros: no subprocess.
- Cons: the matcher has no tracked status, so it drops tracked files that match an ignore
  pattern — this repository's own authority file on any governed machine, so packets
  differed between machines and CI. Nested `.gitignore` is not covered.

### Option C: Read the tracked set from `.git/index`

- Pros: exact tracked status without a subprocess.
- Cons: a git index parser (formats v2–v4, linked worktrees) in `src/`.

## Decision

We choose **Option A**.

1. `listGitIgnoredUntracked(root)` (`src/git_ignored.ts`) returns the untracked, ignored
   files and collapsed directories git reports for `root`. Outside a git work tree, or
   with no git executable, it returns `undefined` and no ignore rules apply. Inside a work
   tree, a failing listing throws rather than guessing.
2. `buildOmitMatcher` takes that set as `gitIgnored`. It is applied after the built-in
   rules and before `.l9metaignore`, `--omit-file` and `--omit`, so an operator source
   keeps the last word (last matching rule wins).
3. `observeRepositoryModel` computes it; inventory, check, apply and skills discovery are
   unchanged.
4. Omitted paths are already counted in the packet's `paths-omitted` notice, so the
   exclusion stays visible.

## Consequences

- A repository-model packet describes only files the repository owns. REG-WU-078-a/b pin
  an ignored lockfile excluded and a non-ignored one reported; -c pins a tracked file
  matching `.gitignore` reported; -d pins `.git/info/exclude`, nested `.gitignore`, and
  `.l9metaignore` negation precedence; -e pins that a non-git directory's `.gitignore`
  has no effect.
- Packets for targets with untracked ignored files change once: those artifacts and facts
  disappear and `paths-omitted` grows.
- A git target observed on a machine without git is treated as non-git (no ignore rules);
  the repository's own state, not the machine, otherwise decides the packet.
