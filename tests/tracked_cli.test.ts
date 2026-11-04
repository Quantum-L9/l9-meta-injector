import { createRequire } from "node:module";
import * as path from "node:path";
import * as os from "node:os";
import { vi } from "vitest";
const require = createRequire(import.meta.url);
const fs: typeof import("node:fs") = require("node:fs");
const cli: {
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
