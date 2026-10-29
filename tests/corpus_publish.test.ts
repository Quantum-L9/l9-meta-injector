// corpus_publish.test.ts — kill it anywhere, and read a whole result set.
//
// The previous commit path staged every projection and then renamed them one by
// one, and said so in its own comment: no userspace sequence of renames is
// atomic as a set. Kill the process between the twelfth rename and the
// thirteenth and the output directory holds a coverage report describing one
// corpus beside a readiness document describing another. Both parse. Neither
// says which run it came from, so the mixture is undetectable by reading it.
//
// The tests below crash the publish at each point it can be crashed and then
// check the one property that matters afterwards: what a reader resolves is a
// complete set from a single run. Not "no error was thrown" — the reader's view,
// reconstructed from disk exactly as a consumer would reconstruct it.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  CORPUS_CURRENT_SCHEMA,
  generationId,
  listGenerations,
  publishCorpusGeneration,
  readCorpusCurrent,
  resolveCurrentGeneration,
} from "../src/corpus_publish";

// A read made before another publisher moved, acted on after it moved (G01). Two
// publishers in one synchronous test cannot interleave on their own, so the seam
// hands the next `seam.reads` reads of `seam.file` the earlier snapshot; every other
// filesystem call is real.
const seam = vi.hoisted(() => ({ file: "", text: "", reads: 0 }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((target: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (seam.reads > 0 && typeof target === "string" && path.resolve(target) === seam.file) {
      seam.reads -= 1;
      return seam.text;
    }
    return (actual.readFileSync as (...args: unknown[]) => unknown)(target, ...rest);
  }) as typeof fs.readFileSync;
  return { ...actual, readFileSync, default: { ...actual, readFileSync } };
});

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-publish-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** One run's output set, tagged so a mixture between runs is visible. */
function runFiles(tag: string): { path: string; contents: string }[] {
  return [
    { path: "corpus-snapshot.json", contents: `{"run":"${tag}","kind":"snapshot"}\n` },
    { path: "corpus-coverage.json", contents: `{"run":"${tag}","kind":"coverage"}\n` },
    { path: "readiness-evidence.json", contents: `{"run":"${tag}","kind":"readiness"}\n` },
    { path: "corpus-candidates.json", contents: `{"run":"${tag}","kind":"candidates"}\n` },
    { path: "roots/old-ssd/document-index.json", contents: `{"run":"${tag}","root":"old-ssd"}\n` },
    { path: "roots/backup/document-index.json", contents: `{"run":"${tag}","root":"backup"}\n` },
  ];
}

/**
 * Which run a reader would see, resolved the way a consumer resolves it.
 *
 * Reads through `CURRENT.json`, parses every file it names, and returns the set
 * of run tags found. One tag means one run's output. Two would be the mixture
 * the whole layout exists to prevent.
 */
function readerView(outDir: string): { tags: string[]; count: number; missing: string[] } | null {
  const resolved = resolveCurrentGeneration(outDir);
  if (resolved === null) return null;
  const tags = new Set<string>();
  for (const file of resolved.files) {
    tags.add(JSON.parse(fs.readFileSync(file.absolute, "utf8")).run as string);
  }
  return { tags: [...tags].sort(), count: resolved.files.length, missing: resolved.missing };
}

class InjectedCrash extends Error {}

describe("publishing one generation", () => {
  it("puts every projection in one directory and one pointer beside it", () => {
    const out = tmp();
    const result = publishCorpusGeneration({
      outDir: out, files: runFiles("first"), committedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(fs.readdirSync(out).sort()).toEqual(["CURRENT.json", "generations"]);
    const current = readCorpusCurrent(out);
    expect(current?.schema).toBe(CORPUS_CURRENT_SCHEMA);
    expect(current?.generation_id).toBe(result.generation_id);
    expect(current?.files).toHaveLength(6);
    // Every file the pointer names carries a hash of its bytes, so a generation
    // that lost or gained a file after the fact is detectable rather than merely
    // unlucky.
    for (const entry of current?.files ?? []) {
      expect(entry.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }

    const view = readerView(out);
    expect(view?.tags).toEqual(["first"]);
    expect(view?.count).toBe(6);
    expect(view?.missing).toEqual([]);
  });

  it("names the generation by its contents, so an unchanged rerun is a no-op", () => {
    const out = tmp();
    const first = publishCorpusGeneration({
      outDir: out, files: runFiles("same"), committedAt: "2026-01-01T00:00:00.000Z",
    });
    const second = publishCorpusGeneration({
      outDir: out, files: runFiles("same"), committedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(second.generation_id).toBe(first.generation_id);
    expect(second.reused).toBe(true);
    expect(second.written_paths).toEqual([]);
    expect(listGenerations(out)).toHaveLength(1);
    // A retry after a crash therefore converges instead of leaving a trail of
    // near-identical generations behind it.
    expect(readerView(out)?.tags).toEqual(["same"]);
  });

  it("gives a different id to a different output set", () => {
    expect(generationId(runFiles("a"))).not.toBe(generationId(runFiles("b")));
    // And the same id whatever order the files arrive in.
    expect(generationId(runFiles("a"))).toBe(generationId([...runFiles("a")].reverse()));
  });

  it("refuses a path that would escape its generation", () => {
    const out = tmp();
    for (const bad of ["../escape.json", "/etc/passwd", "roots/../../escape.json", ""]) {
      expect(() => publishCorpusGeneration({
        outDir: out,
        files: [{ path: bad, contents: "{}\n" }],
        committedAt: "2026-01-01T00:00:00.000Z",
      }), bad).toThrow(/outside its generation/);
    }
  });
});

describe("crashing mid-publish", () => {
  it("leaves the previous run whole when it dies before the switch", () => {
    const out = tmp();
    publishCorpusGeneration({
      outDir: out, files: runFiles("first"), committedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(() => publishCorpusGeneration({
      outDir: out,
      files: runFiles("second"),
      committedAt: "2026-01-02T00:00:00.000Z",
      // The generation is fully written at this point and nothing points at it.
      beforeSwitch: () => {
        throw new InjectedCrash("killed after writing, before switching");
      },
    })).toThrow(InjectedCrash);

    // The reader sees the first run, entire. Not a mixture, and not nothing.
    const view = readerView(out);
    expect(view?.tags).toEqual(["first"]);
    expect(view?.count).toBe(6);
    expect(view?.missing).toEqual([]);
  });

  it("leaves nothing readable when the very first publish dies before the switch", () => {
    const out = tmp();
    expect(() => publishCorpusGeneration({
      outDir: out,
      files: runFiles("first"),
      committedAt: "2026-01-01T00:00:00.000Z",
      beforeSwitch: () => {
        throw new InjectedCrash("killed before the first switch");
      },
    })).toThrow(InjectedCrash);

    // An unreferenced directory on disk and no pointer: a consumer resolving the
    // published set correctly finds nothing, rather than finding a directory
    // full of files nobody promised were complete.
    expect(readCorpusCurrent(out)).toBeNull();
    expect(readerView(out)).toBeNull();
    expect(listGenerations(out)).toHaveLength(1);
  });

  it("recovers on the next attempt, reusing nothing it cannot vouch for", () => {
    const out = tmp();
    publishCorpusGeneration({
      outDir: out, files: runFiles("first"), committedAt: "2026-01-01T00:00:00.000Z",
    });
    try {
      publishCorpusGeneration({
        outDir: out,
        files: runFiles("second"),
        committedAt: "2026-01-02T00:00:00.000Z",
        beforeSwitch: () => {
          throw new InjectedCrash("crash");
        },
      });
    } catch {
      // Expected; the retry below is the point.
    }

    // The half-published generation directory exists but was never pointed at,
    // so the retry writes it fresh rather than trusting whatever is there. A
    // file the first attempt failed on cannot survive as a remnant beside its
    // correct siblings.
    const retry = publishCorpusGeneration({
      outDir: out, files: runFiles("second"), committedAt: "2026-01-03T00:00:00.000Z",
    });
    expect(retry.reused).toBe(false);
    expect(retry.written_paths).toHaveLength(6);
    expect(readerView(out)?.tags).toEqual(["second"]);
  });

  it("never lets a reader see two runs at once, at any point in a sequence", () => {
    const out = tmp();
    publishCorpusGeneration({
      outDir: out, files: runFiles("gen-0"), committedAt: "2026-01-01T00:00:00.000Z",
    });

    // Crash every run, at the one moment a run can be crashed and still have
    // written something, and check the reader after each.
    for (let i = 1; i <= 6; i += 1) {
      try {
        publishCorpusGeneration({
          outDir: out,
          files: runFiles(`gen-${i}`),
          committedAt: `2026-01-0${i}T00:00:00.000Z`,
          beforeSwitch: () => {
            throw new InjectedCrash(`crash ${i}`);
          },
        });
      } catch {
        // Expected on every iteration.
      }
      const view = readerView(out);
      // Always exactly one run's worth of files, and always the last one that
      // completed. Never six of one run and none of another.
      expect(view?.tags, `after crash ${i}`).toEqual(["gen-0"]);
      expect(view?.count, `after crash ${i}`).toBe(6);
      expect(view?.missing, `after crash ${i}`).toEqual([]);
    }
  });

  it("reports a generation that lost a file rather than returning the rest", () => {
    const out = tmp();
    const result = publishCorpusGeneration({
      outDir: out, files: runFiles("first"), committedAt: "2026-01-01T00:00:00.000Z",
    });
    fs.rmSync(path.join(result.generation_directory, "corpus-coverage.json"));

    // Silently returning five of six files is how a partial set gets read as a
    // whole one. The pointer said six; five is a broken generation and says so.
    const view = readerView(out);
    expect(view?.count).toBe(5);
    expect(view?.missing).toEqual(["corpus-coverage.json"]);
  });

  it("treats an unreadable pointer as no pointer", () => {
    const out = tmp();
    publishCorpusGeneration({
      outDir: out, files: runFiles("first"), committedAt: "2026-01-01T00:00:00.000Z",
    });
    fs.writeFileSync(path.join(out, "CURRENT.json"), "{ truncated", "utf8");
    // Better than a half-parsed pointer into a directory that may not be there.
    expect(readCorpusCurrent(out)).toBeNull();
  });
});

describe("pruning old generations", () => {
  it("keeps the requested number and never the one in use", () => {
    const out = tmp();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(publishCorpusGeneration({
        outDir: out,
        files: runFiles(`gen-${i}`),
        committedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
        keep: 2,
      }).generation_id);
    }

    expect(listGenerations(out)).toHaveLength(2);
    // The newest is still readable and whole, which is the only thing pruning
    // must not break.
    const view = readerView(out);
    expect(view?.tags).toEqual(["gen-4"]);
    expect(view?.missing).toEqual([]);
    expect(readCorpusCurrent(out)?.generation_id).toBe(ids[4]);
  });

  it("keeps at least the current generation however small the request", () => {
    const out = tmp();
    publishCorpusGeneration({
      outDir: out, files: runFiles("a"), committedAt: "2026-01-01T00:00:00.000Z", keep: 0,
    });
    publishCorpusGeneration({
      outDir: out, files: runFiles("b"), committedAt: "2026-01-02T00:00:00.000Z", keep: 0,
    });
    expect(listGenerations(out)).toHaveLength(1);
    expect(readerView(out)?.tags).toEqual(["b"]);
  });

  it("leaves an unreferenced directory rather than risking one in use", () => {
    const out = tmp();
    publishCorpusGeneration({
      outDir: out, files: runFiles("a"), committedAt: "2026-01-01T00:00:00.000Z", keep: 5,
    });
    // A directory a crash left behind, pointed at by nothing.
    const orphan = path.join(out, "generations", "0".repeat(64));
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, "partial.json"), "{}\n", "utf8");

    publishCorpusGeneration({
      outDir: out, files: runFiles("b"), committedAt: "2026-01-02T00:00:00.000Z", keep: 5,
    });
    // Under the retention limit, so it stays. Disk is the cost; removing
    // something a reader is using would be the alternative.
    expect(listGenerations(out)).toContain("0".repeat(64));
    expect(readerView(out)?.tags).toEqual(["b"]);
  });
});

describe("retention by recency (RC-069, ADR-066)", () => {
  /** Publish runs with distinct content; return each run's generation directory name. */
  function publishRuns(out: string, tags: string[], keep: number): string[] {
    return tags.map((tag, index) => {
      const result = publishCorpusGeneration({
        outDir: out,
        files: runFiles(tag),
        committedAt: `2026-02-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        keep,
      });
      return path.basename(result.generation_directory);
    });
  }

  it("REG-WU-042-RC-069-a: keep=2 retains the two most recently published generations, whatever their hashes", () => {
    const contentSets = [
      ["r1", "r2", "r3", "r4", "r5", "r6"],
      ["s6", "s5", "s4", "s3", "s2", "s1"],
      ["alpha", "omega", "beta", "psi", "gamma", "chi"],
    ];
    const hashOrders = new Set<string>();
    for (const tags of contentSets) {
      const out = tmp();
      const names = publishRuns(out, tags, 2);
      hashOrders.add(names.map((name) => [...names].sort().indexOf(name)).join(","));
      expect(listGenerations(out)).toEqual([names[4], names[5]].sort());
      expect(readerView(out)?.tags).toEqual([tags[5]]);
    }
    // At least two content sets whose hashes sort in different orders.
    expect(hashOrders.size).toBeGreaterThan(1);
  });

  it("REG-WU-042-RC-069-b: with keep>=2 the generation CURRENT named before a switch survives it", () => {
    for (const keep of [2, 3]) {
      const out = tmp();
      for (let index = 0; index < 8; index += 1) {
        const before = readCorpusCurrent(out);
        publishCorpusGeneration({
          outDir: out, files: runFiles(`k${keep}-${index}`), committedAt: "2026-03-01T00:00:00.000Z", keep,
        });
        if (before !== null) {
          expect(listGenerations(out)).toContain(before.generation_ref.split("/")[1]);
        }
      }
    }
  });

  it("REG-WU-042-RC-069-c: an orphan under the retention limit is kept", () => {
    const out = tmp();
    publishRuns(out, ["a"], 5);
    const orphan = path.join(out, "generations", "f".repeat(64));
    fs.mkdirSync(orphan, { recursive: true });
    const names = publishRuns(out, ["b"], 5);
    expect(listGenerations(out)).toContain("f".repeat(64));
    expect(listGenerations(out)).toContain(names[0]);
  });

  it("REG-WU-042-RC-069-c: unrecorded directories are pruned before any recorded generation", () => {
    const out = tmp();
    const names = publishRuns(out, ["p1", "p2"], 3);
    const orphan = "f".repeat(64);
    fs.mkdirSync(path.join(out, "generations", orphan), { recursive: true });
    const third = publishRuns(out, ["p3"], 3);
    expect(listGenerations(out)).toEqual([names[0], names[1], third[0]].sort());
  });

  it("REG-WU-042-RC-069-d: a pointer from the old release (no history) keeps its generation; unrecorded ones go first", () => {
    const out = tmp();
    const names = publishRuns(out, ["o1", "o2", "o3"], 10);
    // Rewrite CURRENT.json as the previous release wrote it: no history field.
    const currentFile = path.join(out, "CURRENT.json");
    const legacy = JSON.parse(fs.readFileSync(currentFile, "utf8")) as Record<string, unknown>;
    delete legacy.previous_generation_ids;
    fs.writeFileSync(currentFile, `${JSON.stringify(legacy)}\n`, "utf8");
    expect(readCorpusCurrent(out)?.generation_ref).toBe(`generations/${names[2]}`);

    const next = publishRuns(out, ["o4"], 2);
    expect(listGenerations(out)).toEqual([names[2], next[0]].sort());
    expect(readCorpusCurrent(out)?.previous_generation_ids).toEqual([legacy.generation_id]);
  });

  it("records previous generations newest first and bounds the list", () => {
    const out = tmp();
    const ids: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      ids.push(publishCorpusGeneration({
        outDir: out, files: runFiles(`h-${index}`), committedAt: "2026-03-01T00:00:00.000Z", keep: 1,
      }).generation_id);
    }
    const history = readCorpusCurrent(out)?.previous_generation_ids ?? [];
    expect(history[0]).toBe(ids[28]);
    expect(history.length).toBeLessThan(30);
    expect(history).toEqual(ids.slice(0, 29).reverse().slice(0, history.length));
  });
});

describe("one publisher per output root (RC-072, ADR-066)", () => {
  const LOCK = ".corpus-publish.lock";

  it("REG-WU-042-RC-072-a: a second publisher during the first is refused and the first's generation survives", () => {
    const out = tmp();
    publishCorpusGeneration({ outDir: out, files: runFiles("base"), committedAt: "2026-04-01T00:00:00.000Z", keep: 1 });
    let refusal: unknown = null;
    publishCorpusGeneration({
      outDir: out,
      files: runFiles("A"),
      committedAt: "2026-04-02T00:00:00.000Z",
      keep: 1,
      beforeSwitch: () => {
        try {
          publishCorpusGeneration({ outDir: out, files: runFiles("B"), committedAt: "2026-04-03T00:00:00.000Z", keep: 1 });
        } catch (error) {
          refusal = error;
        }
      },
    });
    expect(String(refusal)).toContain(path.join(out, LOCK));
    const view = readerView(out);
    expect(view?.tags).toEqual(["A"]);
    expect(view?.missing).toEqual([]);
    expect(fs.existsSync(path.join(out, LOCK))).toBe(false);
  });

  it("REG-WU-042-RC-072-b: a stale lock whose pid is not alive on this host is taken over", () => {
    const out = tmp();
    fs.writeFileSync(path.join(out, LOCK), `${JSON.stringify({ pid: 999999999, host: os.hostname() })}\n`, "utf8");
    publishCorpusGeneration({ outDir: out, files: runFiles("after-crash"), committedAt: "2026-04-01T00:00:00.000Z" });
    expect(readerView(out)?.tags).toEqual(["after-crash"]);
    expect(fs.existsSync(path.join(out, LOCK))).toBe(false);
  });

  it("refuses, naming the lock file, when the lock is held by a live process or another host", () => {
    for (const holder of [{ pid: process.ppid, host: os.hostname() }, { pid: 999999999, host: `${os.hostname()}-elsewhere` }]) {
      const out = tmp();
      fs.writeFileSync(path.join(out, LOCK), `${JSON.stringify(holder)}\n`, "utf8");
      expect(() => publishCorpusGeneration({ outDir: out, files: runFiles("x"), committedAt: "2026-04-01T00:00:00.000Z" }))
        .toThrow(path.join(out, LOCK));
      expect(listGenerations(out)).toEqual([]);
      expect(fs.existsSync(path.join(out, LOCK))).toBe(true);
    }
  });

  it("REG-WU-042-RC-072-c: a crash before the switch releases the lock and a retry recovers", () => {
    const out = tmp();
    publishCorpusGeneration({ outDir: out, files: runFiles("first"), committedAt: "2026-04-01T00:00:00.000Z" });
    expect(() => publishCorpusGeneration({
      outDir: out,
      files: runFiles("second"),
      committedAt: "2026-04-02T00:00:00.000Z",
      beforeSwitch: () => {
        throw new InjectedCrash("killed before switching");
      },
    })).toThrow(InjectedCrash);
    expect(fs.existsSync(path.join(out, LOCK))).toBe(false);
    publishCorpusGeneration({ outDir: out, files: runFiles("second"), committedAt: "2026-04-03T00:00:00.000Z" });
    const view = readerView(out);
    expect(view?.tags).toEqual(["second"]);
    expect(view?.missing).toEqual([]);
  });

  const GUARD = `${LOCK}.takeover`;
  const deadHolder = (stamp: string) =>
    `${JSON.stringify({ pid: 999999999, host: os.hostname(), acquired_at: stamp })}\n`;
  afterEach(() => {
    seam.reads = 0;
  });

  it("REG-AUDIT-G01-a: two publishers that both observed the same stale lock leave exactly one owner", () => {
    const out = tmp();
    const lock = path.join(out, LOCK);
    const stale = deadHolder("2026-01-01T00:00:00.000Z");
    fs.writeFileSync(lock, stale, "utf8");
    let refusal: unknown = null;
    let ownerBefore: string | null = null;
    let ownerAfter: string | null = null;
    publishCorpusGeneration({
      outDir: out,
      files: runFiles("A"),
      committedAt: "2026-04-01T00:00:00.000Z",
      keep: 1,
      beforeSwitch: () => {
        ownerBefore = fs.readFileSync(lock, "utf8");
        // B read the stale lock before A replaced it, and acts on that read now.
        Object.assign(seam, { file: lock, text: stale, reads: 1 });
        try {
          publishCorpusGeneration({ outDir: out, files: runFiles("B"), committedAt: "2026-04-02T00:00:00.000Z", keep: 1 });
        } catch (error) {
          refusal = error;
        }
        seam.reads = 0;
        ownerAfter = fs.existsSync(lock) ? fs.readFileSync(lock, "utf8") : null;
      },
    });
    expect(ownerBefore).not.toBe(stale);
    expect(String(refusal)).toContain(lock);
    // A still holds the lock it took over; B neither removed it nor replaced it.
    expect(ownerAfter).toBe(ownerBefore);
    expect(readerView(out)?.tags).toEqual(["A"]);
    expect(fs.readdirSync(out).sort()).toEqual(["CURRENT.json", "generations"]);
  });

  it("REG-AUDIT-G01-b: a takeover guard left by a dead same-host pid does not wedge the next publisher", () => {
    const out = tmp();
    fs.writeFileSync(path.join(out, LOCK), deadHolder("2026-01-01T00:00:00.000Z"), "utf8");
    fs.writeFileSync(path.join(out, GUARD), deadHolder("2026-01-01T00:00:01.000Z"), "utf8");
    publishCorpusGeneration({ outDir: out, files: runFiles("after-crash"), committedAt: "2026-04-01T00:00:00.000Z" });
    expect(readerView(out)?.tags).toEqual(["after-crash"]);
    // The dead guard was reaped, not stepped around: nothing is left in the root.
    expect(fs.readdirSync(out).sort()).toEqual(["CURRENT.json", "generations"]);
    // And the next publisher is not wedged either.
    publishCorpusGeneration({ outDir: out, files: runFiles("next"), committedAt: "2026-04-02T00:00:00.000Z" });
    expect(readerView(out)?.tags).toEqual(["next"]);
  });

  it("REG-AUDIT-G01-c: a stale lock whose takeover guard is held by a live process is refused, nothing written", () => {
    const out = tmp();
    const stale = deadHolder("2026-01-01T00:00:00.000Z");
    const guard = `${JSON.stringify({ pid: process.ppid, host: os.hostname(), acquired_at: "2026-01-01T00:00:02.000Z" })}\n`;
    fs.writeFileSync(path.join(out, LOCK), stale, "utf8");
    fs.writeFileSync(path.join(out, GUARD), guard, "utf8");
    expect(() => publishCorpusGeneration({ outDir: out, files: runFiles("x"), committedAt: "2026-04-01T00:00:00.000Z" }))
      .toThrow(path.join(out, LOCK));
    expect(listGenerations(out)).toEqual([]);
    expect(fs.readFileSync(path.join(out, LOCK), "utf8")).toBe(stale);
    expect(fs.readFileSync(path.join(out, GUARD), "utf8")).toBe(guard);
  });

  it("REG-AUDIT-G01-d: reaping a guard that was replaced after it was read puts the live guard back and refuses", () => {
    const out = tmp();
    const stale = deadHolder("2026-01-01T00:00:00.000Z");
    const live = `${JSON.stringify({ pid: process.ppid, host: os.hostname(), acquired_at: "2026-01-01T00:00:03.000Z" })}\n`;
    fs.writeFileSync(path.join(out, LOCK), stale, "utf8");
    fs.writeFileSync(path.join(out, GUARD), live, "utf8");
    // The publisher read a dead guard; by the time it reaps, a live one stands there.
    Object.assign(seam, { file: path.join(out, GUARD), text: deadHolder("2026-01-01T00:00:01.000Z"), reads: 1 });
    expect(() => publishCorpusGeneration({ outDir: out, files: runFiles("x"), committedAt: "2026-04-01T00:00:00.000Z" }))
      .toThrow(path.join(out, LOCK));
    expect(listGenerations(out)).toEqual([]);
    expect(fs.readFileSync(path.join(out, GUARD), "utf8")).toBe(live);
    expect(fs.readFileSync(path.join(out, LOCK), "utf8")).toBe(stale);
    expect(fs.readdirSync(out).sort()).toEqual([LOCK, GUARD].sort());
  });

  it("refuses to switch to a generation whose files are missing", () => {
    const out = tmp();
    publishCorpusGeneration({ outDir: out, files: runFiles("first"), committedAt: "2026-04-01T00:00:00.000Z" });
    expect(() => publishCorpusGeneration({
      outDir: out,
      files: runFiles("second"),
      committedAt: "2026-04-02T00:00:00.000Z",
      beforeSwitch: ({ directory }) => fs.rmSync(path.join(directory, "corpus-coverage.json")),
    })).toThrow(/corpus-coverage\.json/);
    expect(readerView(out)?.tags).toEqual(["first"]);
  });
});
