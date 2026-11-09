// local_source_generated_at.test.ts — a pinned --generated-at makes a corpus run
// reproducible, and moves nothing but the times it records (ADR-092).
//
// In corpus mode the CLI used to record the wall clock in each root's
// acquisition manifest (observed_at) and in the corpus-intelligence packet
// (created_at), and ignored --generated-at for the root packets, so two runs over
// the same bytes never published the same generation. These tests run the real
// CLI twice with the same pinned instant, compare the published generations, and
// check that the semantic identities are the ones an unpinned run computes.
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "..");
const CLI = path.join(REPO, "scripts", "local-source-cli.js");
const PINNED = "2026-11-09T00:00:00.000Z";

const scratch: string[] = [];
function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

let root: string;

function run(extra: string[]): { out: string; status: number | null; stderr: string } {
  const out = path.join(tmp("l9-generated-at-out-"), "observation");
  const cache = path.join(tmp("l9-generated-at-cache-"), "cache");
  const result = cp.spawnSync(
    process.execPath,
    [CLI, "--root", `${root}=Designs`, "--out", out, "--cache-dir", cache, "--no-diff", ...extra],
    { encoding: "utf8" },
  );
  return { out, status: result.status, stderr: result.stderr };
}

interface Published {
  generationId: string;
  files: Map<string, string>;
  dir: string;
}

function published(out: string): Published {
  const current = JSON.parse(fs.readFileSync(path.join(out, "CURRENT.json"), "utf8"));
  return {
    generationId: current.generation_id,
    files: new Map(current.files.map((file: { path: string; content_hash: string }) => [file.path, file.content_hash])),
    dir: path.join(out, ...String(current.generation_ref).split("/")),
  };
}

function json(dir: string, relative: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, relative), "utf8"));
}

/** Every `*_at` value recorded anywhere in the generation's files. */
function recordedTimes(dir: string): string[] {
  const times: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else for (const match of fs.readFileSync(absolute, "utf8").matchAll(/"[a-z_]+_at"\s*:\s*"([^"]+)"/g)) times.push(match[1] as string);
    }
  };
  walk(dir);
  return times;
}

let first: Published;
let second: Published;
let unpinned: Published;

beforeAll(() => {
  root = path.join(tmp("l9-generated-at-src-"), "Designs");
  fs.mkdirSync(path.join(root, "plans"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "plans", "routing.md"),
    "---\nstatus: wip\n---\n# Routing plan\n\nObjective: Route every call through Gate.\n\n- [ ] Write the adapter\n",
  );
  fs.writeFileSync(path.join(root, "notes.txt"), "Depends on: gate-sdk\n");
  const runs = [run(["--generated-at", PINNED]), run(["--generated-at", PINNED]), run([])];
  for (const result of runs) if (result.status !== 0) throw new Error(`local-source failed: ${result.stderr}`);
  [first, second, unpinned] = runs.map((result) => published(result.out)) as [Published, Published, Published];
});

describe("a pinned --generated-at in corpus mode", () => {
  it("publishes the same generation, byte for byte, from two runs over the same bytes", () => {
    expect(second.generationId).toBe(first.generationId);
    expect([...second.files]).toEqual([...first.files]);
  });

  it("records the pinned instant as every time inside the generation", () => {
    const times = recordedTimes(first.dir);
    expect(times.length).toBeGreaterThan(0);
    expect(new Set(times)).toEqual(new Set([PINNED]));
    expect(json(first.dir, "corpus-intelligence/packet.json").created_at).toBe(PINNED);
    expect(json(first.dir, "roots/Designs/local-source-manifest.json").observed_at).toBe(PINNED);
    expect(json(first.dir, "roots/Designs/bundle/manifest.json").created_at).toBe(PINNED);
  });

  it("moves no semantic identity: snapshot, analysis, packets and file set match an unpinned run", () => {
    const pinnedSnapshot = json(first.dir, "corpus-snapshot.json");
    const freeSnapshot = json(unpinned.dir, "corpus-snapshot.json");
    expect(pinnedSnapshot.corpus_source_snapshot_id).toBe(freeSnapshot.corpus_source_snapshot_id);
    expect((pinnedSnapshot.analysis as Record<string, unknown>).corpus_analysis_id).toBe(
      (freeSnapshot.analysis as Record<string, unknown>).corpus_analysis_id,
    );
    const rmp = (snapshot: Record<string, unknown>) =>
      (snapshot.roots as { rmp_packet_id: string }[]).map((entry) => entry.rmp_packet_id);
    expect(rmp(pinnedSnapshot)).toEqual(rmp(freeSnapshot));
    const intelligence = (dir: string) => json(dir, "corpus-intelligence/packet.json");
    expect(intelligence(first.dir).packet_id).toBe(intelligence(unpinned.dir).packet_id);
    expect(intelligence(first.dir).semantic_hash).toBe(intelligence(unpinned.dir).semantic_hash);
    expect([...first.files.keys()]).toEqual([...unpinned.files.keys()]);
  });

  it("leaves an unpinned run recording the wall clock, as it always did", () => {
    expect(json(unpinned.dir, "roots/Designs/local-source-manifest.json").observed_at).not.toBe(PINNED);
    expect(json(unpinned.dir, "corpus-intelligence/packet.json").created_at).not.toBe(PINNED);
  });

  it.each([
    ["a date without a time", "2026-11-09"],
    ["an impossible date", "2026-02-30T00:00:00Z"],
    ["a local offset", "2026-11-09T01:00:00+01:00"],
    ["prose", "yesterday"],
  ])("refuses %s before reading anything", (_label, value) => {
    const result = run(["--generated-at", value]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--generated-at must be a UTC timestamp");
    expect(fs.existsSync(path.join(result.out, "CURRENT.json"))).toBe(false);
  });

  it("refuses the flag without a value", () => {
    const result = run(["--generated-at"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--generated-at needs a value");
  });
});
