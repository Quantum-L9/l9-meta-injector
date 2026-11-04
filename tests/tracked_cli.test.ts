import { createRequire } from "node:module";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { vi } from "vitest";
const require = createRequire(import.meta.url);
const fs: typeof import("node:fs") = require("node:fs");
const cli: {
  main: (argv: string[]) => Promise<number>;
  parseTrackedArguments: (argv: string[], cwd?: string) => Record<string, unknown>;
  writeExternalReport: (root: string, requested: string, bytes: string) => string;
} = require("../scripts/tracked-metadata-cli.js");

const roots: string[] = [];
function fixture(): { base: string; source: string; outside: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "l9-tracked-cli-test-")); roots.push(base);
  const source = path.join(base, "source"), outside = path.join(base, "outside");
  fs.mkdirSync(source); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(source, "unchanged.txt"), "source bytes unchanged\n");
  return { base, source, outside };
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const args = ["tracked-coverage", ".", "--repository", "Owner/Repo", "--revision", "a".repeat(40)];

describe("explicit tracked CLI grammar and external receipt boundary", () => {
  test("known options map to explicit v2 inputs without legacy mutation flags", () => {
    const { source, outside } = fixture();
    const parsed = cli.parseTrackedArguments([...args, "--out", path.join(outside, "receipt.json"), "--timeout-ms", "1000", "--max-output-bytes", "2000"], source);
    expect(parsed).toMatchObject({ mode: "tracked-coverage", root: source, repositoryId: "Owner/Repo", revision: "a".repeat(40), timeoutMs: 1000, maxOutputBytes: 2000, migrateV1: false });
    expect(fs.readdirSync(source)).toEqual(["unchanged.txt"]);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  test.each(["--inject", "--local-files", "--llm", "--dry-run", "--migrate-v1", "extra-positional"])("coverage refuses inadmissible %s before mutation", (option) => {
    const { source } = fixture();
    expect(() => cli.parseTrackedArguments([...args, option], source)).toThrow(/unknown option/);
    expect(fs.readdirSync(source)).toEqual(["unchanged.txt"]);
  });
  test("duplicate/missing values and malformed numeric values are errors", () => {
    const { source } = fixture();
    for (const suffix of [["--revision", "HEAD"], ["--out"], ["--timeout-ms", "1.5"], ["--max-output-bytes", "0"], ["--revision", "--out"]]) {
      expect(() => cli.parseTrackedArguments([...args, ...suffix], source)).toThrow();
    }
  });
  test("root stays relative and contained; export invalidity is pre-operation input admission", () => {
    const { source, outside } = fixture();
    expect(() => cli.parseTrackedArguments(["tracked-coverage", source, ...args.slice(2)], source)).toThrow(/relative/);
    expect(() => cli.parseTrackedArguments(["tracked-coverage", "..", ...args.slice(2)], source)).toThrow(/containment/);
    expect(() => cli.parseTrackedArguments([...args, "--out", path.join(source, "receipt.json")], source)).toThrow(/outside/);
    const existing = path.join(outside, "existing.json"); fs.writeFileSync(existing, "user data");
    expect(() => cli.parseTrackedArguments([...args, "--out", existing], source)).toThrow(/absent/);
    expect(fs.readFileSync(existing, "utf8")).toBe("user data");
    expect(fs.readdirSync(source)).toEqual(["unchanged.txt"]);
  });
  test("migration/writer revision flags are explicit and not accepted by observation", () => {
    const { source } = fixture();
    expect(cli.parseTrackedArguments(["tracked-apply", ...args.slice(1), "--migrate-v1", "--writer-ref", "b".repeat(40)], source)).toMatchObject({ migrateV1: true, expectedWriterRef: "b".repeat(40) });
    expect(() => cli.parseTrackedArguments([...args, "--writer-ref", "v4"], source)).toThrow(/unknown option/);
  });
  test.skipIf(!fs.existsSync("/proc/self/fd"))("external export creates one 0600 artifact and never a source report or sidecar", () => {
    const { source, outside } = fixture();
    const target = path.join(outside, "receipt.json");
    expect(cli.writeExternalReport(source, target, '{"content_hash":null}\n')).toBe(target);
    expect(fs.readFileSync(target, "utf8")).toBe('{"content_hash":null}\n');
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(source)).toEqual(["unchanged.txt"]);
    expect(fs.readdirSync(outside)).toEqual(["receipt.json"]);
    expect(() => cli.writeExternalReport(source, target, "replace")).toThrow(/absent/);
  });
  test("source destination and symlinked destination/ancestry are refused without dereference", () => {
    const { source, outside } = fixture();
    const original = path.join(source, "unchanged.txt");
    expect(() => cli.writeExternalReport(source, original, "bad")).toThrow(/outside/);
    const link = path.join(outside, "receipt.json"); fs.symlinkSync(original, link);
    expect(() => cli.writeExternalReport(source, link, "bad")).toThrow(/absent/);
    const directoryLink = path.join(outside, "linked"); fs.symlinkSync(source, directoryLink);
    expect(() => cli.writeExternalReport(source, path.join(directoryLink, "new.json"), "bad")).toThrow(/ancestry/);
    expect(fs.readFileSync(original, "utf8")).toBe("source bytes unchanged\n");
    expect(fs.existsSync(path.join(source, "new.json"))).toBe(false);
  });
  test.skipIf(!fs.existsSync("/proc/self/fd"))("a raced-in output is never overwritten and the owned temporary is cleaned", () => {
    const { source, outside } = fixture();
    const target = path.join(outside, "receipt.json");
    const originalLink = fs.linkSync;
    vi.spyOn(fs, "linkSync").mockImplementation((from, to) => {
      fs.writeFileSync(target, "raced-in user data");
      return originalLink(from, to);
    });
    expect(() => cli.writeExternalReport(source, target, "new data")).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("raced-in user data");
    expect(fs.readdirSync(outside)).toEqual(["receipt.json"]);
    expect(fs.readdirSync(source)).toEqual(["unchanged.txt"]);
  });
  test.skipIf(!fs.existsSync("/proc/self/fd"))("a moved pinned export parent rolls back only its owned output", () => {
    const { source, outside } = fixture();
    const moved = path.join(source, "moved-report-parent");
    const originalLink = fs.linkSync;
    vi.spyOn(fs, "linkSync").mockImplementation((from, to) => {
      fs.renameSync(outside, moved);
      return originalLink(from, to);
    });
    expect(() => cli.writeExternalReport(source, path.join(outside, "receipt.json"), "new data")).toThrow(/moved/);
    expect(fs.readdirSync(moved)).toEqual([]);
    expect(fs.readFileSync(path.join(source, "unchanged.txt"), "utf8")).toBe("source bytes unchanged\n");
  });
});

describe.skipIf(!fs.existsSync("/proc/self/fd"))("external receipt cleanup ownership and failure aggregation", () => {
  test("write, temporary cleanup and descriptor-close failures retain every error and close both descriptors", () => {
    const { source, outside } = fixture();
    const writeError = new Error("write failed");
    const unlinkError = new Error("temporary cleanup failed");
    const closeError = new Error("descriptor close reported failure");
    const originalClose = fs.closeSync;
    const closed: number[] = [];
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw writeError; });
    vi.spyOn(fs, "unlinkSync").mockImplementation(() => { throw unlinkError; });
    vi.spyOn(fs, "closeSync").mockImplementation(fd => {
      originalClose(fd);
      closed.push(fd);
      throw closeError;
    });
    let failure: unknown;
    try {
      cli.writeExternalReport(source, path.join(outside, "receipt.json"), "new data");
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    const aggregate = failure as AggregateError;
    expect(aggregate.message).toMatch(/write failed/);
    expect(aggregate.message).toMatch(/temporary cleanup failed/);
    expect(aggregate.errors).toContain(unlinkError);
    expect(aggregate.errors).toContain(closeError);
    expect((aggregate.errors[0] as AggregateError).errors).toEqual([writeError, closeError]);
    expect(closed).toHaveLength(2);
    expect(fs.existsSync(path.join(outside, "receipt.json"))).toBe(false);
  });

  test("a temporary cleanup failure rolls back an installed owned output and still closes the directory", () => {
    const { source, outside } = fixture();
    const target = path.join(outside, "receipt.json");
    const originalUnlink = fs.unlinkSync;
    const close = vi.spyOn(fs, "closeSync");
    vi.spyOn(fs, "unlinkSync").mockImplementation(file => {
      if (String(file).endsWith(".tmp")) throw new Error("temporary cleanup failed");
      return originalUnlink(file);
    });
    expect(() => cli.writeExternalReport(source, target, "new data")).toThrow(/temporary cleanup failed/);
    expect(fs.existsSync(target)).toBe(false);
    expect(close).toHaveBeenCalledTimes(2);
  });

  test("commit, temporary cleanup and owned rollback failures are aggregated before returning", () => {
    const { source, outside } = fixture();
    const commitError = new Error("directory commit failed");
    const temporaryError = new Error("temporary cleanup failed");
    const rollbackError = new Error("owned output rollback failed");
    const originalSync = fs.fsyncSync;
    const close = vi.spyOn(fs, "closeSync");
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
      if (fs.fstatSync(fd).isDirectory()) throw commitError;
      return originalSync(fd);
    });
    vi.spyOn(fs, "unlinkSync").mockImplementation(file => {
      throw String(file).endsWith(".tmp") ? temporaryError : rollbackError;
    });
    let failure: unknown;
    try {
      cli.writeExternalReport(source, path.join(outside, "receipt.json"), "new data");
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([commitError, temporaryError, rollbackError]);
    expect(close).toHaveBeenCalledTimes(2);
  });

  test("a commit failure cannot roll back a replacement belonging to the caller", () => {
    const { source, outside } = fixture();
    const target = path.join(outside, "receipt.json");
    const originalSync = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
      originalSync(fd);
      if (fs.fstatSync(fd).isDirectory()) {
        fs.unlinkSync(target);
        fs.writeFileSync(target, "replacement user data");
        throw new Error("directory commit failed");
      }
    });
    expect(() => cli.writeExternalReport(source, target, "new data")).toThrow(/directory commit failed/);
    expect(fs.readFileSync(target, "utf8")).toBe("replacement user data");
    expect(fs.readdirSync(outside)).toEqual(["receipt.json"]);
  });

  test("an exclusive temporary-create race never removes an unowned temporary", () => {
    const { source, outside } = fixture();
    const originalOpen = fs.openSync;
    const error = Object.assign(new Error("temporary raced in"), { code: "EEXIST" });
    vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
      if (String(file).endsWith(".tmp")) {
        fs.writeFileSync(file, "raced-in user temporary");
        throw error;
      }
      return originalOpen(file, flags, mode);
    });
    expect(() => cli.writeExternalReport(source, path.join(outside, "receipt.json"), "new data")).toThrow(error);
    const names = fs.readdirSync(outside);
    expect(names).toHaveLength(1);
    expect(fs.readFileSync(path.join(outside, names[0]), "utf8")).toBe("raced-in user temporary");
  });
});

const qualificationScript = path.resolve("scripts/qualify-tracked-snapshot.js");
function qualify(source: string, outside: string, producerDir = path.resolve(".")) {
  return spawnSync(process.execPath, [qualificationScript, source, "Owner/Repo", "HEAD", outside, producerDir, "a".repeat(40)], { encoding: "utf8", timeout: 30000 });
}

describe("repository-only qualification output admission", () => {
  test("an output directory symlink into source fails before loading the producer or chmod/write", () => {
    const { base, source, outside } = fixture();
    const link = path.join(outside, "linked-source");
    fs.symlinkSync(source, link);
    const before = fs.statSync(source);
    const result = qualify(source, link, path.join(base, "missing-producer"));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ancestry.*outside source/);
    expect(fs.readdirSync(source)).toEqual(["unchanged.txt"]);
    expect(fs.statSync(source).mode).toBe(before.mode);
    expect(fs.statSync(source).mtimeMs).toBe(before.mtimeMs);
  });

  test("a missing output beneath a symlink into source is never created", () => {
    const { source, outside } = fixture();
    const link = path.join(outside, "linked-source");
    fs.symlinkSync(source, link);
    const result = qualify(source, path.join(link, "new-output"));
    expect(result.status).not.toBe(0);
    expect(fs.readdirSync(source)).toEqual(["unchanged.txt"]);
  });

  test("source paths, nonprivate directories and existing outputs are rejected without changing them", () => {
    const { source, outside } = fixture();
    expect(qualify(source, source).stderr).toMatch(/outside source/);
    fs.chmodSync(outside, 0o755);
    expect(qualify(source, outside).stderr).toMatch(/caller-owned private directory/);
    expect(fs.statSync(outside).mode & 0o777).toBe(0o755);
    fs.chmodSync(outside, 0o700);
    const target = path.join(outside, "result.json");
    fs.writeFileSync(target, "caller result");
    expect(qualify(source, outside).stderr).toMatch(/destination must be absent/);
    expect(fs.readFileSync(target, "utf8")).toBe("caller result");
    expect(fs.readdirSync(outside)).toEqual(["result.json"]);
  });

  test.skipIf(!fs.existsSync("/proc/self/fd"))("a private canonical external directory receives three non-overwriting 0600 artifacts", () => {
    const { source, outside } = fixture();
    fs.chmodSync(outside, 0o700);
    for (const argv of [["init", "-q"], ["add", "unchanged.txt"], ["-c", "user.name=CLI Test", "-c", "user.email=cli@example.invalid", "commit", "-qm", "fixture"]]) {
      const git = spawnSync("/usr/bin/git", argv, { cwd: source, encoding: "utf8" });
      expect(git.status, git.stderr).toBe(0);
    }
    const before = fs.statSync(path.join(source, "unchanged.txt"));
    const result = qualify(source, outside);
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readdirSync(outside)).toEqual(["coverage-receipt.json", "metadata-index.snapshot.jsonl", "result.json"]);
    for (const name of fs.readdirSync(outside)) {
      expect(fs.statSync(path.join(outside, name)).mode & 0o777).toBe(0o600);
    }
    const receipt = JSON.parse(fs.readFileSync(path.join(outside, "result.json"), "utf8"));
    expect(receipt).toMatchObject({ status: "passed", source_filesystem_unchanged: true, subject_payload_inspection: false, exact_set_verified: true, counts: { blobs: 1, gitlinks: 0, hidden: 0, symlinks: 0 } });
    expect(fs.statSync(path.join(source, "unchanged.txt"))).toMatchObject({ mode: before.mode, size: before.size, mtimeMs: before.mtimeMs, ino: before.ino });
    expect(qualify(source, outside).stderr).toMatch(/destination must be absent/);
  });
});

test("tracked main awaits its operation and reports invalid input with a nonzero exit", async () => {
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  await expect(cli.main(["tracked-unknown"])).resolves.toBe(2);
  expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/unknown tracked operation/));
});
