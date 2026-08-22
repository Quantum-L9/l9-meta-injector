// local_source_cli.test.ts — the shipped command, run as a user runs it.
//
// The CLI is the only place where acquisition, packet emission and corpus
// analysis are wired together into one output layout, and it is the surface a
// person actually operates. Everything below runs the real script against the
// committed `dist/`, so a wiring mistake between the three layers fails here
// rather than in someone's terminal.
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeCorpusFixture } from "./helpers/corpus_fixtures";
import { treeSnapshot } from "./helpers/zip_fixtures";

const REPO = path.resolve(__dirname, "..");
const CLI = path.join(REPO, "scripts", "local-source-cli.js");

const scratchDirs: string[] = [];
function tmp(prefix = "l9-cli-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  outDir: string;
  source: string;
}

function runCli(extraArgs: string[] = []): Run {
  const source = writeCorpusFixture(path.join(tmp(), "corpus"));
  const outDir = path.join(tmp("l9-cli-out-"), "observation");
  const result = cp.spawnSync(
    process.execPath,
    [CLI, source, "--name", "sample-corpus", "--out", outDir, ...extraArgs],
    { encoding: "utf8" },
  );
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", outDir, source };
}

describe("local-source CLI", () => {
  it("emits the bundle, the manifest and both corpus outputs", () => {
    const run = runCli();
    expect(run.status, run.stderr).toBe(0);
    for (const relative of [
      "bundle/manifest.json",
      "bundle/packet.json",
      "bundle/receipts/validation-receipt.json",
      "local-source-manifest.json",
      "corpus-index.json",
      "corpus-report.md",
    ]) {
      expect(fs.existsSync(path.join(run.outDir, relative)), relative).toBe(true);
    }
    const index = JSON.parse(fs.readFileSync(path.join(run.outDir, "corpus-index.json"), "utf8"));
    const packet = JSON.parse(fs.readFileSync(path.join(run.outDir, "bundle", "packet.json"), "utf8"));
    expect(index.schema).toBe("l9.corpus-index/v1");
    expect(index.repository_model.packet_id).toBe(packet.packet_id);
    expect(index.repository_model.semantic_hash).toBe(packet.semantic_hash);
  });

  it("prints the corpus summary a reader needs to act on", () => {
    const { stdout, status, stderr } = runCli();
    expect(status, stderr).toBe(0);
    for (const line of [
      "the source was NOT modified",
      "artifacts",
      "assertions",
      "work signals",
      "open tasks",
      "declared kinds",
      "declared status",
      "exact duplicates",
      "near-duplicates",
      "corpus index",
      "corpus report",
    ]) {
      expect(stdout, line).toContain(line);
    }
    // The one sentence that must survive every future edit to this output.
    expect(stdout).toContain("no file was written, renamed, or removed under it");
    // And the one claim the similarity numbers must never be read as making.
    expect(stdout).toContain("lexical similarity only; they claim no shared topic");
  });

  it("leaves the observed source byte-identical", () => {
    const source = writeCorpusFixture(path.join(tmp(), "corpus"));
    const before = treeSnapshot(source);
    const outDir = path.join(tmp("l9-cli-out-"), "observation");
    const result = cp.spawnSync(process.execPath, [CLI, source, "--out", outDir], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(treeSnapshot(source)).toEqual(before);
    expect(fs.existsSync(path.join(source, "corpus-index.json"))).toBe(false);
  });

  it("honours --near-duplicate-threshold", () => {
    const strict = runCli(["--near-duplicate-threshold", "0.99"]);
    const loose = runCli(["--near-duplicate-threshold", "0.5"]);
    expect(strict.status, strict.stderr).toBe(0);
    const read = (run: Run): { threshold: number; count: number } => {
      const index = JSON.parse(fs.readFileSync(path.join(run.outDir, "corpus-index.json"), "utf8"));
      return {
        threshold: index.analysis_profile.near_duplicate_threshold,
        count: index.near_duplicate_candidates.length,
      };
    };
    expect(read(strict).threshold).toBe(0.99);
    expect(read(loose).threshold).toBe(0.5);
    expect(read(strict).count).toBeLessThan(read(loose).count);
  });

  it("honours --no-near-duplicates while still reporting exact duplicates", () => {
    const run = runCli(["--no-near-duplicates"]);
    expect(run.status, run.stderr).toBe(0);
    const index = JSON.parse(fs.readFileSync(path.join(run.outDir, "corpus-index.json"), "utf8"));
    expect(index.analysis_profile.near_duplicate_enabled).toBe(false);
    expect(index.near_duplicate_candidates).toEqual([]);
    expect(index.summary.exact_duplicate_cluster_count).toBeGreaterThan(0);
    expect(run.stdout).toContain("analysis disabled");
  });

  it("rejects a threshold outside the unit interval", () => {
    const run = runCli(["--near-duplicate-threshold", "7"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("--near-duplicate-threshold must be a number within [0, 1]");
  });

  it("produces byte-identical outputs for the same corpus at a different absolute path", () => {
    const first = runCli();
    const second = runCli();
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    for (const relative of ["corpus-index.json", "corpus-report.md", "bundle/packet.json"]) {
      expect(
        fs.readFileSync(path.join(first.outDir, relative), "utf8"),
        relative,
      ).toBe(fs.readFileSync(path.join(second.outDir, relative), "utf8"));
    }
  });
});
