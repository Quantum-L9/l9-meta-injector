import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TrackedGitEntry } from "../../src/discovery_contracts";
import { gitExecutable } from "../../src/git_runtime";

const scratch: string[] = [];
const git = gitExecutable();
if (git === null) throw new Error("Git fixtures require Git");

export function fixtureEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith("GIT_")) env[key] = value;
  return {
    ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2020-01-01T00:00:00+00:00", GIT_COMMITTER_DATE: "2020-01-01T00:00:00+00:00",
  };
}

export function fixtureGit(root: string, args: readonly string[], input?: string | Buffer): Buffer {
  const result = spawnSync(git!, [...args], {
    cwd: root, env: fixtureEnvironment(), input, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`Fixture git ${args.join(" ")} failed: ${result.stderr?.toString()}`);
  return result.stdout;
}

export function scratchDirectory(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-tree-census-"));
  scratch.push(root);
  return root;
}

export function cleanupGitFixtures(): void {
  for (const root of scratch.splice(0)) fs.rmSync(root, { recursive: true, force: true });
}

export function fixtureRepository(format: "sha1" | "sha256" = "sha1", bare = false): string {
  const root = scratchDirectory();
  fixtureGit(root, ["init", ...(bare ? ["--bare"] : []), `--object-format=${format}`, "--initial-branch=main", "."]);
  return root;
}

export function fixtureBlob(root: string, bytes: string | Buffer = "not inspected\n"): string {
  return fixtureGit(root, ["hash-object", "-w", "--stdin"], bytes).toString("ascii").trim();
}

export interface FixtureLeaf {
  readonly path: string | Buffer;
  readonly mode?: TrackedGitEntry["mode"];
  readonly oid?: string;
  readonly contents?: string | Buffer;
}
interface TreeNode {
  leaves: { name: Buffer; mode: TrackedGitEntry["mode"]; oid: string }[];
  dirs: Map<string, { name: Buffer; node: TreeNode }>;
}

/** Construct raw Git names without asking the host filesystem to materialize them. */
export function fixtureTree(root: string, leaves: readonly FixtureLeaf[]): string {
  const tree: TreeNode = { leaves: [], dirs: new Map() };
  for (const leaf of leaves) {
    const raw = typeof leaf.path === "string" ? Buffer.from(leaf.path) : leaf.path;
    const parts: Buffer[] = [];
    let start = 0;
    for (let i = 0; i <= raw.length; i += 1) {
      if (i === raw.length || raw[i] === 47) { parts.push(raw.subarray(start, i)); start = i + 1; }
    }
    let node = tree;
    for (const name of parts.slice(0, -1)) {
      const key = name.toString("base64");
      if (!node.dirs.has(key)) node.dirs.set(key, { name, node: { leaves: [], dirs: new Map() } });
      node = node.dirs.get(key)!.node;
    }
    const mode = leaf.mode ?? "100644";
    const oid = leaf.oid ?? fixtureBlob(root, leaf.contents);
    node.leaves.push({ name: parts[parts.length - 1], mode, oid });
  }
  function write(node: TreeNode): string {
    const rows = node.leaves.map(({ name, mode, oid }) => Buffer.concat([
      Buffer.from(`${mode} ${mode === "160000" ? "commit" : "blob"} ${oid}\t`), name, Buffer.from([0]),
    ]));
    for (const { name, node: child } of node.dirs.values()) rows.push(Buffer.concat([
      Buffer.from(`040000 tree ${write(child)}\t`), name, Buffer.from([0]),
    ]));
    return fixtureGit(root, ["mktree", "-z", "--missing"], Buffer.concat(rows)).toString("ascii").trim();
  }
  return write(tree);
}

export function fixtureCommit(root: string, tree: string, parent?: string): string {
  return fixtureGit(root, ["commit-tree", tree, ...(parent ? ["-p", parent] : [])], "fixture\n").toString("ascii").trim();
}

export function setFixtureHead(root: string, revision: string, checkout = false): void {
  fixtureGit(root, ["update-ref", "refs/heads/main", revision]);
  if (checkout) fixtureGit(root, ["reset", "--hard", revision]);
}

export function writeFixtureFile(root: string, relative: string, contents: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

export function supportsSha256(): boolean {
  try { fixtureRepository("sha256"); return true; } catch { return false; }
}
