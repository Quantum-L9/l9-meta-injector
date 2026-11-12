import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isGitIgnored, listGitIgnoredUntracked } from "../src/git_ignored";
import { assertTrackedWorktreeCurrent, readTrackedGitSnapshot } from "../src/git_tree";
import {
  cleanupGitFixtures,
  fixtureCommit,
  fixtureGit,
  fixtureRepository,
  fixtureTree,
  scratchDirectory,
  setFixtureHead,
  supportsSha256,
  writeFixtureFile,
} from "./helpers/git_tree_fixtures";

afterEach(cleanupGitFixtures);
const repositoryId = "fixture:exact-tree";
const census = (root: string, revision = "HEAD") =>
  readTrackedGitSnapshot({ root, revision, repositoryId });

function cleanFixture() {
  const root = fixtureRepository();
  const tree = fixtureTree(root, [
    { path: "source.txt", contents: "source\n" },
    { path: "nested/other.txt", contents: "other\n" },
    { path: ".l9/metadata-index.jsonl", contents: "old index\n" },
  ]);
  const revision = fixtureCommit(root, tree);
  setFixtureHead(root, revision, true);
  return { root, revision, tree, snapshot: census(root) };
}

describe("immutable Git leaf census", () => {
  it("enumerates history, not staged/dirty files or ignored/untracked noise", () => {
    const root = fixtureRepository();
    const aTree = fixtureTree(root, [
      { path: ".gitignore", contents: "ignored/\nnoise.log\n" },
      { path: "source.txt", contents: "A\n" },
      { path: "ignored/forced.bin", contents: "force tracked\n" },
      { path: "gone.txt", contents: "gone\n" },
    ]);
    const a = fixtureCommit(root, aTree);
    setFixtureHead(root, a, true);
    const atA = census(root, a);
    writeFixtureFile(root, "source.txt", "staged B\n");
    fixtureGit(root, ["add", "source.txt"]);
    writeFixtureFile(root, "source.txt", "dirty C\n");
    fs.unlinkSync(path.join(root, "gone.txt"));
    writeFixtureFile(root, "new.txt", "ordinary untracked\n");
    writeFixtureFile(root, "ignored/noise.bin", "ignored\n");
    writeFixtureFile(root, "noise.log", "ignored\n");
    expect(census(root, a)).toEqual(atA);
    const bTree = fixtureTree(root, [{ path: "source.txt", contents: "committed B\n" }]);
    const b = fixtureCommit(root, bTree, a);
    setFixtureHead(root, b);
    expect(census(root, "main")).toMatchObject({ revision: b, tree_oid: bTree });
    expect(census(root, b).entries.map((e) => e.path)).toEqual(["source.txt"]);
    expect(census(root, a)).toEqual(atA);
    // Extraction preserved legacy observation: forced tracked ignored files stay ours.
    const ignored = listGitIgnoredUntracked(root)!;
    expect(isGitIgnored(ignored, "ignored/noise.bin")).toBe(true);
    setFixtureHead(root, a);
    expect(isGitIgnored(listGitIgnoredUntracked(root)!, "ignored/forced.bin")).toBe(false);
  });

  it("never filters hidden, generated, dependencies, protected state or archives", () => {
    const root = fixtureRepository();
    const paths = [
      ".env",
      ".hidden/deep.txt",
      ".github/workflows/a.yml",
      ".claude/secret",
      ".cursor/a",
      ".l9/meta-authority.yaml",
      ".l9/metadata-index.jsonl",
      "GIT_TREE_MANIFEST.json",
      "dist/bundle.js",
      "node_modules/vendor/lib.bin",
      "out/generated.lock",
      "archive.zip",
      "unknown",
    ];
    const tree = fixtureTree(
      root,
      paths.map((p) => ({ path: p, contents: Buffer.from([0, 255, 1]) })),
    );
    const revision = fixtureCommit(root, tree);
    setFixtureHead(root, revision);
    expect(new Set(census(root).entries.map((e) => e.path))).toEqual(new Set(paths));
    // None of these paths even exists in the checkout.
    expect(fs.existsSync(path.join(root, "unknown"))).toBe(false);
  });

  it("preserves tabs/newlines, spelling, BOM, and invalid UTF-8 losslessly in raw byte order", () => {
    const root = fixtureRepository();
    const names = [
      "a-b.md",
      "a_b.md",
      "a/b.md",
      "A.md",
      "a.md",
      "é.md",
      "e\u0301.md",
      "u00e9.md",
      "tab\tname\n.md",
      "literal\\name.md",
      "\ufeffname",
      "nul-looking%00.md",
    ];
    const invalid = Buffer.from([0x62, 0xff, 0x2e, 0x6d, 0x64]);
    const tree = fixtureTree(root, [...names.map((p) => ({ path: p })), { path: invalid }]);
    const revision = fixtureCommit(root, tree);
    const snapshot = census(root, revision);
    const bytes = [...names.map((n) => Buffer.from(n)), invalid].sort(Buffer.compare);
    expect(snapshot.entries.map((e) => e.path_bytes_base64)).toEqual(
      bytes.map((b) => b.toString("base64")),
    );
    for (const name of names) expect(snapshot.entries.find((e) => e.path === name)).toBeDefined();
    const undecodable = snapshot.entries.find(
      (e) => e.path_bytes_base64 === invalid.toString("base64"),
    )!;
    expect(undecodable.path).toBeNull();
    expect(Buffer.from(undecodable.path_bytes_base64, "base64")).toEqual(invalid);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.entries)).toBe(true);
    expect(Object.isFrozen(snapshot.entries[0])).toBe(true);
  });

  it("preserves executable, symlink and gitlink modes without reading/requiring targets", () => {
    const root = fixtureRepository();
    const absent = "d".repeat(40);
    const tree = fixtureTree(root, [
      { path: "run", mode: "100755" },
      { path: "external", mode: "120000", contents: "/does/not/exist" },
      { path: "cycle", mode: "120000", contents: "cycle" },
      { path: "directory", mode: "120000", contents: "/tmp" },
      { path: "submodule", mode: "160000", oid: absent },
      { path: "missing-blob", oid: "e".repeat(40) },
    ]);
    const revision = fixtureCommit(root, tree);
    const entries = census(root, revision).entries;
    expect(entries.find((e) => e.path === "run")?.mode).toBe("100755");
    expect(entries.filter((e) => e.mode === "120000")).toHaveLength(3);
    expect(entries.find((e) => e.path === "submodule")).toMatchObject({
      mode: "160000",
      object_type: "commit",
      object_oid: absent,
    });
    expect(entries).toHaveLength(6);
  });

  it("lists the full repository from a nested location and from a bare object store", () => {
    const { root, snapshot } = cleanFixture();
    expect(census(path.join(root, "nested"))).toEqual(snapshot);
    const bare = fixtureRepository("sha1", true);
    const tree = fixtureTree(bare, [{ path: "a/b.md" }]);
    const revision = fixtureCommit(bare, tree);
    expect(census(bare, revision).entries[0].path).toBe("a/b.md");
  });

  it("supports linked worktrees without assuming .git is a directory", () => {
    const { root, revision, snapshot } = cleanFixture();
    const linked = path.join(scratchDirectory(), "linked");
    fixtureGit(root, ["worktree", "add", "--detach", linked, revision]);
    expect(fs.statSync(path.join(linked, ".git")).isFile()).toBe(true);
    expect(census(linked)).toEqual(snapshot);
    expect(() => assertTrackedWorktreeCurrent(snapshot, linked)).not.toThrow();
  });

  it("pins real objects despite replace refs and inherited repository/config redirects", () => {
    const { root, revision, snapshot } = cleanFixture();
    const other = fixtureRepository();
    const otherTree = fixtureTree(other, [{ path: "redirected" }]);
    const otherRevision = fixtureCommit(other, otherTree);
    setFixtureHead(other, otherRevision);
    const replacementTree = fixtureTree(root, [{ path: "replacement" }]);
    const replacement = fixtureCommit(root, replacementTree);
    fixtureGit(root, ["replace", revision, replacement]);
    const variables = {
      GIT_DIR: path.join(other, ".git"),
      GIT_WORK_TREE: other,
      GIT_COMMON_DIR: path.join(other, ".git"),
      GIT_OBJECT_DIRECTORY: path.join(other, ".git/objects"),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(other, ".git/objects"),
      GIT_INDEX_FILE: path.join(other, ".git/index"),
      GIT_NAMESPACE: "redirect",
      GIT_REPLACE_REF_BASE: "refs/replace/",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.bare",
      GIT_CONFIG_VALUE_0: "true",
      GIT_CONFIG_PARAMETERS: "'core.bare'='true'",
      GIT_CONFIG_SYSTEM: "/not/config",
      GIT_CONFIG_GLOBAL: "/not/config",
      GIT_NO_REPLACE_OBJECTS: "0",
      GIT_NO_LAZY_FETCH: "0",
      GIT_ALLOW_PROTOCOL: "all",
      GIT_TRACE: "/not/trace",
    };
    const previous = Object.fromEntries(
      Object.keys(variables).map((key) => [key, process.env[key]]),
    );
    try {
      Object.assign(process.env, variables);
      expect(census(root)).toEqual(snapshot);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("fails missing Git repositories, unborn branches, missing selectors, and output caps", () => {
    expect(() => census(scratchDirectory())).toThrow();
    const empty = fixtureRepository();
    expect(() => census(empty)).toThrow();
    const { root } = cleanFixture();
    expect(() => census(root, "does-not-exist")).toThrow();
    expect(() => census(root, "--output=/tmp/unsafe")).toThrow();
    expect(() =>
      readTrackedGitSnapshot({ root, revision: "HEAD", repositoryId, maxOutputBytes: 2 }),
    ).toThrow(/cap/);
    for (const maxOutputBytes of [0, -1, NaN, Infinity, 1.5]) {
      expect(() =>
        readTrackedGitSnapshot({ root, revision: "HEAD", repositoryId, maxOutputBytes }),
      ).toThrow(/integer/);
    }
    expect(() =>
      readTrackedGitSnapshot({ root, revision: "HEAD", repositoryId, timeoutMs: 0 }),
    ).toThrow(/integer/);
    expect(() => readTrackedGitSnapshot({ root, revision: "", repositoryId })).toThrow(/selector/);
    expect(() => readTrackedGitSnapshot({ root, revision: "HEAD", repositoryId: "" })).toThrow(
      /identity/,
    );
  });

  it("fails a missing recursive tree, with lazy fetching and protocols disabled", () => {
    const root = fixtureRepository();
    const subtree = fixtureTree(root, [{ path: "file" }]);
    const tree = fixtureTree(root, [{ path: "nested/file" }]);
    const revision = fixtureCommit(root, tree);
    const file = path.join(root, ".git/objects", subtree.slice(0, 2), subtree.slice(2));
    fs.unlinkSync(file);
    fixtureGit(root, ["config", "remote.origin.promisor", "true"]);
    fixtureGit(root, ["config", "remote.origin.url", "https://127.0.0.1:9/forbidden"]);
    fixtureGit(root, ["config", "extensions.partialClone", "origin"]);
    expect(() => census(root, revision)).toThrow(/failed/);
    expect(fs.existsSync(file)).toBe(false);
  });

  it.skipIf(!supportsSha256())("validates SHA-256 identities rather than assuming SHA-1", () => {
    const root = fixtureRepository("sha256");
    const tree = fixtureTree(root, [
      { path: "sha256.bin" },
      { path: "sub", mode: "160000", oid: "d".repeat(64) },
    ]);
    const revision = fixtureCommit(root, tree);
    expect(census(root, revision)).toMatchObject({
      object_format: "sha256",
      revision,
      tree_oid: tree,
    });
    for (const entry of census(root, revision).entries)
      expect(entry.object_oid).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats an empty committed tree as complete and preserves ignored non-Git fallback", () => {
    const root = fixtureRepository();
    const revision = fixtureCommit(root, fixtureTree(root, []));
    expect(census(root, revision).entries).toEqual([]);
    expect(listGitIgnoredUntracked(scratchDirectory())).toBeUndefined();
  });
});

describe("apply-only tracked currentness guard", () => {
  it("permits only index-output changes and ordinary local noise, including from a nested root", () => {
    const { root, snapshot } = cleanFixture();
    writeFixtureFile(root, ".l9/metadata-index.jsonl", "new index\n");
    fixtureGit(root, ["add", ".l9/metadata-index.jsonl"]);
    writeFixtureFile(root, ".l9/metadata-index.jsonl", "unstaged next index\n");
    writeFixtureFile(root, "untracked.txt", "noise\n");
    writeFixtureFile(root, ".local-hidden", "noise\n");
    expect(() => assertTrackedWorktreeCurrent(snapshot, path.join(root, "nested"))).not.toThrow();
  });

  it("rejects unstaged, staged, deleted and newly tracked source changes", () => {
    for (const change of ["unstaged", "staged", "deleted", "added"]) {
      const { root, snapshot } = cleanFixture();
      if (change === "deleted") fs.unlinkSync(path.join(root, "source.txt"));
      else if (change === "added") {
        writeFixtureFile(root, "added.txt", "new\n");
        fixtureGit(root, ["add", "added.txt"]);
      } else {
        writeFixtureFile(root, "source.txt", "changed\n");
        if (change === "staged") fixtureGit(root, ["add", "source.txt"]);
      }
      expect(() => assertTrackedWorktreeCurrent(snapshot, root)).toThrow(/Tracked source/);
    }
  });

  it("does not exclude another index-like basename or nested metadata-index output", () => {
    const root = fixtureRepository();
    const tree = fixtureTree(root, [{ path: "nested/.l9/metadata-index.jsonl" }]);
    setFixtureHead(root, fixtureCommit(root, tree), true);
    const snapshot = census(root);
    writeFixtureFile(root, "nested/.l9/metadata-index.jsonl", "changed\n");
    expect(() => assertTrackedWorktreeCurrent(snapshot, root)).toThrow(/unstaged/);
  });

  it("rejects HEAD movement even when source entries are unchanged", () => {
    const { root, snapshot, tree, revision } = cleanFixture();
    setFixtureHead(root, fixtureCommit(root, tree, revision));
    expect(() => assertTrackedWorktreeCurrent(snapshot, root)).toThrow(/HEAD/);
  });

  it("fails closed on assume-unchanged and skip-worktree flags without mutating the index", () => {
    for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
      const { root, snapshot } = cleanFixture();
      fixtureGit(root, ["update-index", flag, "source.txt"]);
      writeFixtureFile(root, "source.txt", "hidden dirty source\n");
      const index = fs.readFileSync(path.join(root, ".git/index"));
      expect(() => assertTrackedWorktreeCurrent(snapshot, root)).toThrow(/index flags/);
      expect(fs.readFileSync(path.join(root, ".git/index"))).toEqual(index);
    }
  });

  it.skipIf(process.platform === "win32")(
    "holds changed directory symlinks before diff can read external files",
    () => {
      const { root, snapshot } = cleanFixture();
      const external = scratchDirectory();
      writeFixtureFile(external, "other.txt", "external should never be read\n");
      fs.rmSync(path.join(root, "nested"), { recursive: true });
      fs.symlinkSync(external, path.join(root, "nested"));
      expect(() => assertTrackedWorktreeCurrent(snapshot, root)).toThrow(/ancestor/);
    },
  );

  it.skipIf(process.platform === "win32")(
    "checks symlink-as-link changes without dereferencing external or missing targets",
    () => {
      const root = fixtureRepository();
      const tree = fixtureTree(root, [
        { path: "link", mode: "120000", contents: "/missing/target" },
      ]);
      setFixtureHead(root, fixtureCommit(root, tree), true);
      const snapshot = census(root);
      expect(() => assertTrackedWorktreeCurrent(snapshot, root)).not.toThrow();
      fs.unlinkSync(path.join(root, "link"));
      fs.symlinkSync("/another/missing/target", path.join(root, "link"));
      expect(() => assertTrackedWorktreeCurrent(snapshot, root)).toThrow(/unstaged/);
    },
  );

  it("never traverses a gitlink checkout; initialized paths hold rather than asserting false currency", () => {
    const root = fixtureRepository();
    const tree = fixtureTree(root, [{ path: "sub", mode: "160000", oid: "d".repeat(40) }]);
    const revision = fixtureCommit(root, tree);
    setFixtureHead(root, revision);
    fixtureGit(root, ["read-tree", revision]);
    const snapshot = census(root);
    expect(() => assertTrackedWorktreeCurrent(snapshot, root)).not.toThrow();
    fs.mkdirSync(path.join(root, "sub"));
    expect(() => assertTrackedWorktreeCurrent(snapshot, root)).toThrow(/gitlink/);
  });
});
