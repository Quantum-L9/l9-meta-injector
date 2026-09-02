import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect } from "vitest";

const REPO = path.resolve(__dirname, "..");

function walkFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) out.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  walk(root);
  return out.sort();
}

test("PR89 generation probe emits exact TypeScript 5.9.3 dist deltas", () => {
  if (process.env.CI !== "true") return;
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "l9-pr89-dist-"));
  fs.rmSync(worktree, { recursive: true, force: true });
  try {
    const add = spawnSync("git", ["worktree", "add", "--detach", worktree, "HEAD"], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(add.status, add.stderr || add.stdout).toBe(0);
    fs.symlinkSync(path.join(REPO, "node_modules"), path.join(worktree, "node_modules"), "dir");
    const build = spawnSync("npm", ["run", "build"], {
      cwd: worktree,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
      maxBuffer: 16 * 1024 * 1024,
    });
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);

    const generatedRoot = path.join(worktree, "dist");
    for (const relative of walkFiles(generatedRoot)) {
      const generated = fs.readFileSync(path.join(generatedRoot, relative));
      const committedPath = path.join(REPO, "dist", relative);
      const committed = fs.existsSync(committedPath) ? fs.readFileSync(committedPath) : null;
      if (committed !== null && committed.equals(generated)) continue;
      process.stdout.write(`PR89_DIST_FILE\t${relative}\t${generated.toString("base64")}\n`);
    }
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: REPO, encoding: "utf8" });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
}, 120_000);
