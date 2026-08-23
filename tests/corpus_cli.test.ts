// corpus_cli.test.ts — corpus mode as an operator runs it.
//
// The CLI is where the roots, the cache, the session and the five projections are
// wired together, and it is the only surface most people will ever touch. Every
// run below is the real script against the committed `dist/`, so a wiring mistake
// fails here rather than in someone's terminal.
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeMultiRootCorpus } from "./helpers/multi_root_fixtures";
import { treeSnapshot } from "./helpers/zip_fixtures";

const REPO = path.resolve(__dirname, "..");
const CLI = path.join(REPO, "scripts", "local-source-cli.js");

const scratch: string[] = [];
function tmp(prefix = "l9-corpus-cli-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[]): Run {
  const result = cp.spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

interface Fixture {
  corpus: ReturnType<typeof writeMultiRootCorpus>;
  out: string;
  cache: string;
  roots: string[];
}

function fixture(): Fixture {
  const corpus = writeMultiRootCorpus(tmp("l9-corpus-cli-src-"));
  return {
    corpus,
    out: path.join(tmp("l9-corpus-cli-out-"), "observation"),
    cache: path.join(tmp("l9-corpus-cli-cache-"), "cache"),
    roots: [corpus.oldSsd, corpus.backup, corpus.archives],
  };
}

function argsFor(f: Fixture, extra: string[] = []): string[] {
  return [...f.roots.flatMap((root) => ["--root", root]), "--out", f.out, "--cache-dir", f.cache, ...extra];
}

describe("corpus mode", () => {
  it("writes the projection set and leaves every root untouched", () => {
    const f = fixture();
    const before = f.roots.map((root) => treeSnapshot(root));
    const result = run(argsFor(f));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(f.roots.map((root) => treeSnapshot(root))).toEqual(before);

    expect(fs.readdirSync(f.out).sort()).toEqual([
      "corpus-candidates.json",
      "corpus-coverage.json",
      "corpus-session.json",
      "corpus-snapshot.json",
      "readiness-evidence.json",
    ]);
    const snapshot = JSON.parse(fs.readFileSync(path.join(f.out, "corpus-snapshot.json"), "utf8"));
    const candidates = JSON.parse(fs.readFileSync(path.join(f.out, "corpus-candidates.json"), "utf8"));
    const coverage = JSON.parse(fs.readFileSync(path.join(f.out, "corpus-coverage.json"), "utf8"));
    const readiness = JSON.parse(fs.readFileSync(path.join(f.out, "readiness-evidence.json"), "utf8"));
    const session = JSON.parse(fs.readFileSync(path.join(f.out, "corpus-session.json"), "utf8"));

    expect(snapshot.schema).toBe("l9.corpus-snapshot/v1");
    expect(candidates.schema).toBe("l9.corpus-candidates/v1");
    expect(coverage.schema).toBe("l9.corpus-coverage/v1");
    expect(readiness.schema).toBe("l9.readiness-evidence/v1");
    expect(session.schema).toBe("l9.corpus-session/v1");
    expect(snapshot.counts.root_count).toBe(3);
    expect(session.corpus_snapshot_target).toBe(snapshot.corpus_snapshot_id);

    expect(result.stdout).toContain("no root was modified");
    expect(result.stdout).toContain("crossing a root boundary");
    expect(result.stdout).toContain("no ranking, score or priority is produced");
    expect(result.stdout).toContain("no model was called and no network request was made");
  });

  it("keeps every mount point out of the semantic projections", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);
    for (const name of ["corpus-snapshot.json", "corpus-candidates.json", "readiness-evidence.json", "corpus-coverage.json"]) {
      const contents = fs.readFileSync(path.join(f.out, name), "utf8");
      for (const root of f.roots) expect(contents).not.toContain(root);
      expect(contents).not.toContain(os.tmpdir());
    }
    // The session manifest is operational and does carry them, on purpose.
    expect(fs.readFileSync(path.join(f.out, "corpus-session.json"), "utf8")).toContain(f.corpus.oldSsd);
  });

  it("diffs against its own previous snapshot on the next run", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);
    expect(fs.existsSync(path.join(f.out, "corpus-diff.json"))).toBe(false);

    fs.writeFileSync(path.join(f.corpus.oldSsd, "notes/tuesday.md"), "# Tuesday\n\nA new note.\n", "utf8");
    const second = run(argsFor(f));
    expect(second.status).toBe(0);
    const diff = JSON.parse(fs.readFileSync(path.join(f.out, "corpus-diff.json"), "utf8"));
    expect(diff.schema).toBe("l9.corpus-diff/v1");
    expect(diff.counts.added).toBe(1);
    expect(diff.counts.changed_content).toBe(0);
    expect(diff.invalidation.cache_entries_removed).toBe(0);
    expect(second.stdout).toContain("diff             +1 -0 ~0");
    // The second run reused the first run's work for everything that did not move:
    // only the arrival's own layers, and the two corpus-scope analyses, missed.
    const coverage = JSON.parse(fs.readFileSync(path.join(f.out, "corpus-coverage.json"), "utf8"));
    expect(coverage.cache.misses).toBe(6);
    expect(coverage.cache.hit_ratio).toBeGreaterThan(0.8);
  });

  it("resumes a session for the same roots", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);
    const resumed = run(argsFor(f, ["--resume"]));
    expect(resumed.status).toBe(0);
    expect(resumed.stdout).toMatch(/resumed {10}\d+ source\(s\)/);
  });

  it("runs cold when the cache is switched off", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);
    const cold = run([...f.roots.flatMap((root) => ["--root", root]), "--out", f.out, "--no-cache"]);
    expect(cold.status).toBe(0);
    expect(cold.stdout).toContain("cache            off");
  });

  it("accepts a roots manifest", () => {
    const f = fixture();
    const manifest = path.join(tmp("l9-corpus-cli-manifest-"), "roots.json");
    fs.writeFileSync(
      manifest,
      JSON.stringify({ schema: "l9.corpus-roots/v1", roots: f.roots.map((root) => ({ path: root })) }),
      "utf8",
    );
    const result = run(["--root-manifest", manifest, "--out", f.out, "--cache-dir", f.cache]);
    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(f.out, "corpus-snapshot.json"), "utf8")).counts.root_count).toBe(3);
  });

  it("refuses to write its output or its cache inside a root", () => {
    const f = fixture();
    const inside = run([
      "--root", f.corpus.oldSsd,
      "--out", path.join(f.corpus.oldSsd, "out"),
      "--cache-dir", f.cache,
    ]);
    expect(inside.status).not.toBe(0);
    expect(inside.stderr).toContain("refusing to write the corpus output directory inside an observed root");

    const cacheInside = run([
      "--root", f.corpus.oldSsd,
      "--out", f.out,
      "--cache-dir", path.join(f.corpus.oldSsd, "cache"),
    ]);
    expect(cacheInside.status).not.toBe(0);
    expect(cacheInside.stderr).toContain("refusing a cache root inside an observed source tree");
  });

  it("still runs the single-source mode when no root is named", () => {
    const corpus = writeMultiRootCorpus(tmp("l9-corpus-cli-single-"));
    const out = path.join(tmp("l9-corpus-cli-single-out-"), "observation");
    const result = run([corpus.oldSsd, "--out", out]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("local-source: OK");
    expect(fs.existsSync(path.join(out, "corpus-index.json"))).toBe(true);
    expect(fs.existsSync(path.join(out, "corpus-snapshot.json"))).toBe(false);
  });
});
