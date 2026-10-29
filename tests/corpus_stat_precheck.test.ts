// corpus_stat_precheck.test.ts — the stat recorded beside a hash is the stat the
// hash was produced under (RC-063).
//
// A corpus scan acquires its roots one after another and yields between them. A
// file in an earlier root that is rewritten during that yield used to be recorded
// with its new stat and its old hash, and every later incremental run then reused
// the stale hash because the stat "matched". The stat now comes from acquisition.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { acquireLocalSource } from "../src/local_source";
import { runCorpusScan, type CorpusScanResult } from "../src/corpus_scan";
import { writeRawZip } from "./helpers/zip_fixtures";

const roots: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-stat-precheck-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const V1 = "# Doc\n\nVersion one.\n";

function sha(text: string): string {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function twoRoots(): { a: string; b: string; doc: string } {
  const base = tmp();
  const a = path.join(base, "root-a");
  const b = path.join(base, "root-b");
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  const doc = path.join(a, "doc.md");
  fs.writeFileSync(doc, V1);
  // A fixed past mtime, so a rewrite can be given a distinguishable one.
  fs.utimesSync(doc, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
  fs.writeFileSync(path.join(b, "other.md"), "# Other\n");
  return { a, b, doc };
}

function options(a: string, b: string) {
  return {
    roots: [{ path: a, name: "root-a" }, { path: b, name: "root-b" }],
    producerVersion: "test",
    topics: { enabled: false },
    nearDuplicates: { enabled: false },
  };
}

/** Run a scan, rewriting `doc` while the scan yields between roots A and B. */
async function scanWithRewriteBetweenRoots(a: string, b: string, rewrite: () => void): Promise<CorpusScanResult> {
  const pending = runCorpusScan(options(a, b));
  // Root A was acquired synchronously; the scan is now yielding before root B.
  rewrite();
  return pending;
}

function docArtifact(result: CorpusScanResult) {
  const artifact = result.snapshot.artifacts.find((entry) => entry.root_relative_path === "doc.md");
  expect(artifact).toBeDefined();
  return artifact as NonNullable<typeof artifact>;
}

describe("stat_precheck is the hashing stat (RC-063)", () => {
  test("REG-WU-040-RC-063-a: a longer rewrite during the scan is not paired with the old hash", async () => {
    const { a, b, doc } = twoRoots();
    const v2 = "# Doc\n\nVersion two, which is longer than version one.\n";
    const first = await scanWithRewriteBetweenRoots(a, b, () => fs.writeFileSync(doc, v2));
    const recorded = docArtifact(first);
    expect(recorded.content_hash).toBe(sha(V1));
    expect(recorded.stat_precheck?.size_bytes).toBe(Buffer.byteLength(V1));

    const next = await runCorpusScan({ ...options(a, b), verification: "incremental", previousSnapshot: first.snapshot });
    expect(docArtifact(next).content_hash).toBe(sha(v2));
    expect(next.snapshot.verification.fully_rehashed_artifact_count).toBeGreaterThanOrEqual(1);
  });

  test("REG-WU-040-RC-063-b: a same-length rewrite with a new mtime is rehashed on the next incremental run", async () => {
    const { a, b, doc } = twoRoots();
    const v2 = V1.replace("one", "two");
    expect(Buffer.byteLength(v2)).toBe(Buffer.byteLength(V1));
    const first = await scanWithRewriteBetweenRoots(a, b, () => {
      fs.writeFileSync(doc, v2);
      fs.utimesSync(doc, new Date("2026-02-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"));
    });
    expect(docArtifact(first).content_hash).toBe(sha(V1));
    expect(docArtifact(first).stat_precheck?.mtime_ms).toBe(Date.parse("2026-01-01T00:00:00Z"));

    const next = await runCorpusScan({ ...options(a, b), verification: "incremental", previousSnapshot: first.snapshot });
    expect(docArtifact(next).content_hash).toBe(sha(v2));
    expect(next.snapshot.verification.fully_rehashed_artifact_count).toBeGreaterThanOrEqual(1);
  });

  test("REG-WU-040-RC-063-c: an unchanged file is still reused under --incremental", async () => {
    const { a, b } = twoRoots();
    const first = await runCorpusScan(options(a, b));
    const next = await runCorpusScan({ ...options(a, b), verification: "incremental", previousSnapshot: first.snapshot });
    expect(next.snapshot.verification.cached_hash_reuse_count).toBe(2);
    expect(next.snapshot.verification.fully_rehashed_artifact_count).toBe(0);
    expect(docArtifact(next).content_hash).toBe(sha(V1));
    expect(docArtifact(next).stat_precheck).toEqual(docArtifact(first).stat_precheck);
  });

  test("REG-WU-040-RC-063-d: the observation carries one hashing stat per hashed physical file", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs", "b.md"), "# B\n");
    fs.writeFileSync(path.join(root, "big.md"), "x".repeat(4096));
    fs.symlinkSync(path.join(root, "a.md"), path.join(root, "link.md"));
    writeRawZip(path.join(root, "Bundle.zip"), [{ name: "m.md", content: "# M\n" }]);
    const observation = acquireLocalSource({ path: root, scratchParent: tmp(), hashMaxBytes: 1024 });
    try {
      expect([...observation.hashingStats.keys()].sort()).toEqual(["Bundle.zip", "a.md", "docs/b.md"]);
      const stat = fs.statSync(path.join(root, "a.md"));
      expect(observation.hashingStats.get("a.md")).toMatchObject({
        size_bytes: stat.size,
        mtime_ms: Math.trunc(stat.mtimeMs),
      });
    } finally {
      observation.dispose();
    }
  });
});
