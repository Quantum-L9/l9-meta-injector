import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gitExecutable as initialExecutable } from "../src/git_runtime";
import { cleanupGitFixtures, scratchDirectory } from "./helpers/git_tree_fixtures";

const real = initialExecutable();
if (real === null) throw new Error("Runtime tests require installed Git");
const originalPath = process.env.PATH;
afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  vi.resetModules();
  cleanupGitFixtures();
});

async function resolveWith(pathValue: string) {
  process.env.PATH = pathValue;
  vi.resetModules();
  const runtime = await import("../src/git_runtime");
  return runtime.gitExecutable();
}

function stub(root: string, contents = ""): string {
  const filename = path.join(root, "git");
  fs.writeFileSync(filename, contents, { mode: 0o755 });
  return filename;
}

describe.skipIf(process.platform === "win32")("shared internal Git runtime", () => {
  it("skips relative and empty PATH entries and pins an absolute executable", async () => {
    const root = scratchDirectory();
    stub(root);
    expect(
      await resolveWith([".", "relative-bin", "", path.dirname(real!)].join(path.delimiter)),
    ).toBe(real);
    const runtime = await import("../src/git_runtime");
    process.env.PATH = root;
    expect(runtime.gitExecutable()).toBe(real);
  });

  it("returns missing for relative-only PATH and rejects exact census explicitly", async () => {
    expect(await resolveWith([".", "relative-bin", ""].join(path.delimiter))).toBeNull();
    const { readTrackedGitSnapshot } = await import("../src/git_tree");
    expect(() =>
      readTrackedGitSnapshot({
        root: scratchDirectory(),
        revision: "HEAD",
        repositoryId: "fixture",
      }),
    ).toThrow(/absolute Git executable/);
    const { listGitIgnoredUntracked } = await import("../src/git_ignored");
    expect(listGitIgnoredUntracked(scratchDirectory())).toBeUndefined();
  });

  it("skips nonexecutables and directory names while resolving from absolute entries", async () => {
    const nonexecutable = scratchDirectory();
    stub(nonexecutable);
    fs.chmodSync(path.join(nonexecutable, "git"), 0o644);
    const directory = scratchDirectory();
    fs.mkdirSync(path.join(directory, "git"));
    expect(
      await resolveWith([nonexecutable, directory, path.dirname(real!)].join(path.delimiter)),
    ).toBe(real);
  });

  it("a bounded real process timeout fails rather than claiming a partial census", async () => {
    const root = scratchDirectory();
    stub(root, `#!${process.execPath}\nsetTimeout(() => {}, 10000);\n`);
    expect(await resolveWith(root)).toBe(path.join(root, "git"));
    const { readTrackedGitSnapshot } = await import("../src/git_tree");
    expect(() =>
      readTrackedGitSnapshot({ root, revision: "HEAD", repositoryId: "fixture", timeoutMs: 40 }),
    ).toThrow(/timed out/);
  });

  it("a real oversized subprocess output is never parsed as successful tree evidence", async () => {
    const root = scratchDirectory();
    stub(root, `#!${process.execPath}\nrequire('node:fs').writeSync(1, Buffer.alloc(4096, 65));\n`);
    expect(await resolveWith(root)).toBe(path.join(root, "git"));
    const { readTrackedGitSnapshot } = await import("../src/git_tree");
    expect(() =>
      readTrackedGitSnapshot({
        root,
        revision: "HEAD",
        repositoryId: "fixture",
        maxOutputBytes: 32,
      }),
    ).toThrow(/cap/);
  });
});

describe.skipIf(process.platform === "win32")("include bootstrap admission", () => {
  it("rejects include control before launching even a Git that would bootstrap includes", async () => {
    const executableRoot = scratchDirectory(),
      repository = scratchDirectory();
    const launched = path.join(executableRoot, "launched");
    stub(
      executableRoot,
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(launched)}, 'launched');process.exit(42);\n`,
    );
    fs.mkdirSync(path.join(repository, "objects"));
    fs.writeFileSync(path.join(repository, "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(path.join(repository, "config"), "[include]\n  path = payload.conf\n");
    fs.writeFileSync(path.join(repository, "payload.conf"), "not a Git configuration payload\n");
    await resolveWith(executableRoot);
    const { readOnlyGitRunner } = await import("../src/git_runtime");
    expect(() => readOnlyGitRunner(repository)).toThrow(/configuration includes are unsupported/);
    expect(fs.existsSync(launched)).toBe(false);
    expect(fs.readFileSync(path.join(repository, "payload.conf"), "utf8")).toBe(
      "not a Git configuration payload\n",
    );
  });
});
