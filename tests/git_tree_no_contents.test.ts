import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  forbidFs: false,
  allowedControlPaths: new Set<string>(),
  controlDescriptors: new Set<number>(),
  commands: [] as { executable: string; args: string[]; options: SpawnSyncOptions }[],
  fake: undefined as undefined | ((args: string[]) => SpawnSyncReturns<Buffer>),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: (executable: string, args: string[], options: SpawnSyncOptions) => {
    state.commands.push({ executable, args: [...args], options });
    return state.fake ? state.fake(args) : actual.spawnSync(executable, args, options);
  } };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const forbid = (name: string) => (...args: unknown[]) => {
    if (state.forbidFs) throw new Error(`Forbidden filesystem operation during census: ${name}`);
    return (actual[name as keyof typeof actual] as (...args: unknown[]) => unknown)(...args);
  };
  const openControl = (...args: Parameters<typeof actual.openSync>) => {
    if (state.forbidFs && (!state.allowedControlPaths.has(String(args[0])) || typeof args[1] !== "number" || (args[1] & 3) !== 0)) throw new Error("Forbidden subject/control write open during census");
    const fd = actual.openSync(...args);
    if (state.forbidFs) state.controlDescriptors.add(fd);
    return fd;
  };
  const readControl = (...args: unknown[]) => {
    if (state.forbidFs && !state.controlDescriptors.has(args[0] as number)) throw new Error("Forbidden subject descriptor read during census");
    return (actual.readSync as (...values: unknown[]) => number)(...args);
  };
  const closeControl = (fd: number) => { state.controlDescriptors.delete(fd); return actual.closeSync(fd); };
  return { ...actual,
    readFileSync: forbid("readFileSync"), readFile: forbid("readFile"),
    readdirSync: forbid("readdirSync"), readdir: forbid("readdir"),
    readlinkSync: forbid("readlinkSync"), readlink: forbid("readlink"),
    lstatSync: forbid("lstatSync"), lstat: forbid("lstat"),
    openSync: openControl, readSync: readControl, closeSync: closeControl, open: forbid("open"),
    writeFileSync: forbid("writeFileSync"), writeFile: forbid("writeFile"),
    mkdirSync: forbid("mkdirSync"), renameSync: forbid("renameSync"), unlinkSync: forbid("unlinkSync"),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: (...args: Parameters<typeof actual.readFile>) => {
    if (state.forbidFs) throw new Error("Forbidden asynchronous source read during census");
    return actual.readFile(...args);
  } };
});

import { readTrackedGitSnapshot, assertTrackedWorktreeCurrent } from "../src/git_tree";
import {
  cleanupGitFixtures, fixtureRepository, fixtureTree, fixtureCommit, setFixtureHead,
  fixtureGit, writeFixtureFile,
} from "./helpers/git_tree_fixtures";

const commit = "a".repeat(40);
const tree = "b".repeat(40);
const blob = "c".repeat(40);
const repositoryId = "fixture:no-contents";
const commandNames = ["config", "rev-parse", "ls-tree", "diff-index", "ls-files", "diff-files"];
function command(args: string[]): string[] {
  return args.slice(args.findIndex((arg) => commandNames.includes(arg)));
}
function output(stdout: string | Buffer = "", status = 0): SpawnSyncReturns<Buffer> {
  const out = typeof stdout === "string" ? Buffer.from(stdout) : stdout;
  return { status, signal: null, pid: 0, stdout: out, stderr: Buffer.alloc(0), output: [null, out, Buffer.alloc(0)] };
}
function fakeCensus(rows: string | Buffer, options: { format?: string; revision?: string; rootTree?: string } = {}) {
  state.fake = (args) => {
    const argv = command(args);
    if (argv[0] === "config") return output("", 1);
    if (argv[0] === "rev-parse" && argv[1] === "--show-object-format=storage") return output(`${options.format ?? "sha1"}\n`);
    if (argv[0] === "rev-parse" && argv[argv.length - 1] === `${commit}^{tree}`) return output(`${options.rootTree ?? tree}\n`);
    if (argv[0] === "rev-parse") return output(`${options.revision ?? commit}\n`);
    if (argv[0] === "ls-tree") return output(rows);
    throw new Error(`Forbidden command: ${argv.join(" ")}`);
  };
}
function invoke() { return readTrackedGitSnapshot({ root: "/fixture", revision: "HEAD", repositoryId }); }

afterEach(() => { state.forbidFs = false; state.allowedControlPaths.clear(); state.controlDescriptors.clear(); state.commands.length = 0; state.fake = undefined; cleanupGitFixtures(); vi.restoreAllMocks(); });

function filesystemState(root: string): Record<string, string> {
  const values: Record<string, string> = {};
  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full);
      if (entry.isSymbolicLink()) values[relative] = `link:${fs.readlinkSync(full)}`;
      else if (entry.isDirectory()) visit(full);
      else values[relative] = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  }
  visit(root);
  return values;
}

describe("content-free census subprocess and filesystem boundaries", () => {
  it("reads only configuration and commit/tree metadata; no subject APIs, status, blob reads, extraction, hooks or writes", () => {
    const root = fixtureRepository();
    const rootTree = fixtureTree(root, [
      { path: "source.bin", contents: Buffer.from([0, 255, 1]) },
      { path: "link", mode: "120000", contents: "/external/not/read" },
      { path: "archive.zip", contents: "not even a zip\n" },
      { path: "sub", mode: "160000", oid: "d".repeat(40) },
    ]);
    const revision = fixtureCommit(root, rootTree);
    setFixtureHead(root, revision);
    // Working files are unrelated and must remain untouched.
    writeFixtureFile(root, "source.bin", "different checkout bytes\n");
    writeFixtureFile(root, "untracked", "noise\n");
    const before = filesystemState(root);
    state.commands.length = 0;
    let snapshot;
    try {
      for (const control of [".git", ".git/config", ".git/commondir", ".git/config.worktree"]) state.allowedControlPaths.add(path.join(root, control));
      state.forbidFs = true;
      snapshot = readTrackedGitSnapshot({ root, revision: "HEAD", repositoryId });
    } finally { state.forbidFs = false; }
    expect(snapshot!.entries).toHaveLength(4);
    expect(filesystemState(root)).toEqual(before);
    expect(state.commands.map((call) => command(call.args)[0])).toEqual(["config", "rev-parse", "rev-parse", "rev-parse", "ls-tree"]);
    expect(state.commands.filter((call) => command(call.args).includes("HEAD^{commit}"))).toHaveLength(1);
    expect(command(state.commands[state.commands.length - 1].args)).toEqual(["ls-tree", "-r", "-z", "--full-tree", rootTree]);
    for (const call of state.commands) {
      expect(path.isAbsolute(call.executable)).toBe(true);
      expect(call.options.shell).toBe(false);
      expect(call.options.encoding).toBeUndefined();
      expect(call.options.timeout).toBeGreaterThan(0);
      expect(call.args).toContain("--no-optional-locks");
      expect(call.args).toContain("--no-replace-objects");
      expect(call.args).toContain("core.fsmonitor=false");
      expect(call.options.env).toMatchObject({ GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_OPTIONAL_LOCKS: "0" });
      expect(call.options.env?.GIT_DIR).toBeUndefined();
      expect(call.options.env?.GIT_OBJECT_DIRECTORY).toBeUndefined();
      expect(call.options.env?.GIT_ALTERNATE_OBJECT_DIRECTORIES).toBeUndefined();
    }
  });

  it("disables all local promisor remotes before resolving objects, including on older Git", () => {
    const root = fixtureRepository();
    const revision = fixtureCommit(root, fixtureTree(root, [{ path: "file" }]));
    setFixtureHead(root, revision);
    fixtureGit(root, ["config", "remote.origin.promisor", "true"]);
    fixtureGit(root, ["config", "remote.other.promisor", "true"]);
    fixtureGit(root, ["config", "extensions.partialClone", "origin"]);
    state.commands.length = 0;
    expect(readTrackedGitSnapshot({ root, revision: "HEAD", repositoryId }).entries).toHaveLength(1);
    expect(command(state.commands[0].args)[0]).toBe("config");
    for (const call of state.commands.slice(1)) {
      expect(call.args).toContain("remote.origin.promisor=false");
      expect(call.args).toContain("remote.other.promisor=false");
      expect(call.args).toContain("extensions.partialClone=");
      expect(call.options.env?.GIT_ALLOW_PROTOCOL).toBe("");
    }
  });

  it("handles the first TAB only and never decodes invalid UTF-8 with replacement", () => {
    const invalid = Buffer.from([0x70, 0xc0, 0xaf]);
    fakeCensus(Buffer.concat([Buffer.from(`100644 blob ${blob}\tvalid\tline\nname\0`), Buffer.from(`120000 blob ${blob}\t`), invalid, Buffer.from([0])]));
    const entries = invoke().entries;
    expect(entries.find((e) => e.path === "valid\tline\nname")).toBeDefined();
    expect(entries.find((e) => e.path === null)?.path_bytes_base64).toBe(invalid.toString("base64"));
  });

  it.each([
    ["missing NUL", `100644 blob ${blob}\tpath`],
    ["empty row", "\0"],
    ["no TAB", `100644 blob ${blob} path\0`],
    ["empty path", `100644 blob ${blob}\t\0`],
    ["directory mode", `040000 tree ${blob}\tpath\0`],
    ["unsupported mode", `100600 blob ${blob}\tpath\0`],
    ["symlink commit", `120000 commit ${blob}\tpath\0`],
    ["gitlink blob", `160000 blob ${blob}\tpath\0`],
    ["uppercase OID", `100644 blob ${"C".repeat(40)}\tpath\0`],
    ["short OID", `100644 blob ${"c".repeat(39)}\tpath\0`],
    ["long OID", `100644 blob ${"c".repeat(64)}\tpath\0`],
    ["header newline", `100644\nblob ${blob}\tpath\0`],
    ["absolute path", `100644 blob ${blob}\t/path\0`],
    ["traversal path", `100644 blob ${blob}\ta/../path\0`],
    ["empty segment", `100644 blob ${blob}\ta//path\0`],
    ["trailing slash", `100644 blob ${blob}\tpath/\0`],
    ["duplicate", `100644 blob ${blob}\tpath\0` + `100755 blob ${blob}\tpath\0`],
  ])("rejects %s instead of silently dropping a leaf", (_name, rows) => {
    fakeCensus(rows);
    expect(invoke).toThrow();
  });

  it("rejects non-ASCII headers rather than masking high bits", () => {
    const header = Buffer.from(`100644 blob ${blob}\tpath\0`);
    header[0] |= 128;
    fakeCensus(header);
    expect(invoke).toThrow(/ASCII/);
  });

  it("requires matching object-format evidence for scalar object identities", () => {
    fakeCensus("", { format: "sha512" });
    expect(invoke).toThrow(/format/);
    fakeCensus("", { revision: "a".repeat(64) });
    expect(invoke).toThrow(/identity/);
    fakeCensus("", { rootTree: `${tree}\nextra` });
    expect(invoke).toThrow(/identity/);
  });

  it.each(["ENOBUFS", "ETIMEDOUT", "ENOENT"])("fails closed on subprocess %s, not an empty complete snapshot", (code) => {
    state.fake = () => ({ ...output(""), error: Object.assign(new Error("injected"), { code }) });
    expect(invoke).toThrow(code === "ENOBUFS" ? /cap/ : code === "ETIMEDOUT" ? /timed out/ : /execute/);
  });

  it("fails command exits and interruptions even if stdout contains valid-looking rows", () => {
    state.fake = () => output(`100644 blob ${blob}\tpath\0`, 128);
    expect(invoke).toThrow(/failed/);
    state.fake = () => ({ ...output(""), signal: "SIGTERM", status: null });
    expect(invoke).toThrow(/interrupted/);
  });

  it("enforces cumulative stdout/stderr caps independently of a successful exit", () => {
    state.fake = () => output(Buffer.alloc(65 * 1024 * 1024));
    expect(invoke).toThrow(/cap/);
    state.fake = () => ({ ...output("", 1), stderr: Buffer.alloc(65 * 1024 * 1024) });
    expect(invoke).toThrow(/cap/);
  });

  it("reports HEAD movement during the separate guard and never runs the guard in default census", () => {
    const root = fixtureRepository();
    const rootTree = fixtureTree(root, [{ path: "source" }]);
    const revision = fixtureCommit(root, rootTree);
    setFixtureHead(root, revision, true);
    const snapshot = readTrackedGitSnapshot({ root, revision: "HEAD", repositoryId });
    let headChecks = 0;
    const captured = state.commands.length;
    // Intercept only the second HEAD check; all other guard commands run real Git.
    // Use the unmocked native spawn implementation captured before interception.
    return vi.importActual<typeof import("node:child_process")>("node:child_process").then((actual) => {
      state.fake = (args) => {
        if (command(args).includes("HEAD^{commit}") && ++headChecks === 2) return output(`${"f".repeat(40)}\n`);
        return actual.spawnSync(state.commands[state.commands.length - 1].executable, args, state.commands[state.commands.length - 1].options) as SpawnSyncReturns<Buffer>;
      };
      expect(() => assertTrackedWorktreeCurrent(snapshot, root)).toThrow(/HEAD changed/);
      expect(state.commands.slice(0, captured).some((c) => ["diff-index", "diff-files", "ls-files", "status"].includes(command(c.args)[0]))).toBe(false);
    });
  });
});
