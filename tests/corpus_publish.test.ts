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
import { afterAll, describe, expect, it } from "vitest";
import {
  CORPUS_CURRENT_SCHEMA,
  generationId,
  listGenerations,
  publishCorpusGeneration,
  readCorpusCurrent,
  resolveCurrentGeneration,
} from "../src/corpus_publish";

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
