// git_ignored.ts - the paths git itself ignores in a target work tree (ADR-078).
//
// Git ignore rules apply only to untracked files: a tracked or force-added file that
// matches .gitignore is still the repository's. So the observation does not evaluate
// ignore files itself; it asks git for the untracked-and-ignored set, which also covers
// nested .gitignore files, .git/info/exclude, core.excludesFile and linked worktrees
// exactly as git does.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** Untracked, ignored paths relative to the observed root, as git reports them. */
export interface GitIgnoredPaths {
  /** Ignored untracked files. */
  readonly files: ReadonlySet<string>;
  /** Ignored untracked directories (git collapses them), without a trailing slash. */
  readonly directories: readonly string[];
}

let resolvedGit: string | null | undefined;

/**
 * Absolute path to git from PATH, resolved once (WU-069 / S4036): spawning the bare
 * name would let a writable PATH entry choose the binary. Relative PATH entries are
 * skipped. Returns null when no executable git is found.
 */
function gitExecutable(): string | null {
  if (resolvedGit !== undefined) return resolvedGit;
  const names = process.platform === "win32" ? ["git.exe", "git.cmd"] : ["git"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        resolvedGit = candidate;
        return resolvedGit;
      } catch {
        // not here; keep looking
      }
    }
  }
  resolvedGit = null;
  return resolvedGit;
}

function runGit(root: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const git = gitExecutable();
  if (git === null) return { status: null, stdout: "", stderr: "git not found" };
  const result = spawnSync(git, args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * The untracked, ignored paths under `root`, or `undefined` when `root` is not inside a
 * git work tree or no git executable is available (a non-git target has no ignore
 * semantics to honour). Inside a work tree a failing listing throws: guessing would
 * make the packet depend on the machine.
 */
export function listGitIgnoredUntracked(root: string): GitIgnoredPaths | undefined {
  const absolute = path.resolve(root);
  const probe = runGit(absolute, ["rev-parse", "--is-inside-work-tree"]);
  if (probe.status !== 0 || probe.stdout.trim() !== "true") return undefined;
  const listed = runGit(absolute, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
  if (listed.status !== 0) {
    throw new Error(`git ls-files failed under ${absolute}: ${listed.stderr.trim() || `exit ${listed.status}`}`);
  }
  const files = new Set<string>();
  const directories: string[] = [];
  for (const entry of listed.stdout.split("\0")) {
    if (!entry) continue;
    if (entry.endsWith("/")) directories.push(entry.slice(0, -1));
    else files.add(entry);
  }
  directories.sort();
  return { files, directories };
}

/** True when `relPath` is, or lies under, a path git reports as ignored and untracked. */
export function isGitIgnored(ignored: GitIgnoredPaths, relPath: string): boolean {
  if (ignored.files.has(relPath)) return true;
  return ignored.directories.some((dir) => relPath === dir || relPath.startsWith(`${dir}/`));
}
