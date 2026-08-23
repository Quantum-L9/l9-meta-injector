// corpus_session.test.ts — resumption, bounded work, and the atomic output commit.
//
// Three properties, each of which only matters when something goes wrong: a
// manifest is never observed half-written, work never fans out past its budget,
// and a run that dies mid-write leaves the previous complete output set rather
// than a mixture of two.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CORPUS_SESSION_SCHEMA,
  CorpusSessionStore,
  DEFAULT_CORPUS_BUDGETS,
  MemoryBudget,
  boundedMap,
  corpusSessionId,
} from "../src/corpus_session";
import { corpusRootId } from "../src/corpus_roots";

const scratch: string[] = [];
function tmp(prefix = "l9-session-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

const budgets = { ...DEFAULT_CORPUS_BUDGETS, archive: {} };

function roots(...keys: string[]) {
  return keys.map((key) => ({
    root_id: corpusRootId(key),
    root_key: key,
    absolute_path: `/mnt/${key}`,
  }));
}

describe("session identity", () => {
  it("is known from the declared roots alone, before a byte is read", () => {
    expect(corpusSessionId(["B", "A"])).toBe(corpusSessionId(["A", "B"]));
    expect(corpusSessionId(["A"])).not.toBe(corpusSessionId(["A", "B"]));
  });
});

describe("a session manifest", () => {
  it("records completions by content-addressed key and sorts them", () => {
    const file = path.join(tmp(), "corpus-session.json");
    const store = CorpusSessionStore.open({ file, roots: roots("A"), budgets, now: "2026-01-01T00:00:00Z" });
    store.setTarget("corpus-snapshot:target");
    store.completeSource("vsrc:b");
    store.completeSource("vsrc:a");
    store.completeSource("vsrc:a");
    store.completeArchive("sha256:zip");
    store.completeDecoder("normdoc:1");
    store.completeAnalysis("candidate:1");
    store.fail({ code: "corpus.read_failed", severity: "warning", message: "unreadable", corpus_path: "A::x" });
    store.save("2026-01-01T00:00:01Z");

    const written = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(written.schema).toBe(CORPUS_SESSION_SCHEMA);
    expect(written.corpus_snapshot_target).toBe("corpus-snapshot:target");
    expect(written.completed_source_ids).toEqual(["vsrc:a", "vsrc:b"]);
    expect(written.completed_archive_hashes).toEqual(["sha256:zip"]);
    expect(written.completed_decoder_keys).toEqual(["normdoc:1"]);
    expect(written.completed_analysis_keys).toEqual(["candidate:1"]);
    expect(written.failure_diagnostics).toHaveLength(1);
    expect(written.budgets.max_parallel_decoders).toBe(DEFAULT_CORPUS_BUDGETS.max_parallel_decoders);
    expect(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("resumes completions for the same roots and ignores a manifest for other roots", () => {
    const file = path.join(tmp(), "corpus-session.json");
    const first = CorpusSessionStore.open({ file, roots: roots("A", "B"), budgets, now: "t0" });
    first.completeDecoder("normdoc:1");
    first.save("t1");

    const same = CorpusSessionStore.open({ file, roots: roots("B", "A"), budgets, now: "t2", resume: true });
    expect(same.hasDecoderKey("normdoc:1")).toBe(true);
    expect(same.resumedCounts.decoder_keys).toBe(1);

    const other = CorpusSessionStore.open({ file, roots: roots("C"), budgets, now: "t3", resume: true });
    expect(other.hasDecoderKey("normdoc:1")).toBe(false);
  });

  it("starts fresh rather than trusting an unreadable manifest", () => {
    const file = path.join(tmp(), "corpus-session.json");
    fs.writeFileSync(file, "{ truncated", "utf8");
    const store = CorpusSessionStore.open({ file, roots: roots("A"), budgets, now: "t0", resume: true });
    expect(store.resumedCounts.source_ids).toBe(0);
  });

  it("does not resume unless asked", () => {
    const file = path.join(tmp(), "corpus-session.json");
    const first = CorpusSessionStore.open({ file, roots: roots("A"), budgets, now: "t0" });
    first.completeSource("vsrc:a");
    first.save("t1");
    const second = CorpusSessionStore.open({ file, roots: roots("A"), budgets, now: "t2" });
    expect(second.hasSourceId("vsrc:a")).toBe(false);
  });
});

describe("bounded work", () => {
  it("never exceeds its concurrency limit and preserves input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 25 }, (_value, index) => index);
    const results = await boundedMap(items, 4, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return item * 2;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(results).toEqual(items.map((item) => item * 2));
  });

  it("treats a limit below one as one, and an empty list as no work", async () => {
    expect(await boundedMap([], 4, async () => 1)).toEqual([]);
    expect(await boundedMap([1, 2], 0, async (item) => item)).toEqual([1, 2]);
  });

  it("holds concurrent readers under the memory ceiling", async () => {
    const budget = new MemoryBudget(100);
    const order: string[] = [];
    const first = budget.reserve(60).then(() => order.push("first"));
    const second = budget.reserve(60).then(() => order.push("second"));
    await first;
    expect(order).toEqual(["first"]);
    budget.release(60);
    await second;
    expect(order).toEqual(["first", "second"]);
    expect(budget.peakBytes).toBeLessThanOrEqual(100);
    expect(budget.waits).toBeGreaterThan(0);
  });

  it("admits a document larger than the whole budget rather than dropping it", async () => {
    const budget = new MemoryBudget(10);
    await budget.reserve(1000);
    expect(budget.peakBytes).toBe(1000);
    budget.release(1000);
  });
});

describe("the output commit", () => {
  // The staged-then-renamed commit that used to live here is gone, and its tests
  // with it. It could not be atomic as a set — no userspace sequence of renames
  // is — so a process killed between the twelfth rename and the thirteenth left a
  // coverage report from one run beside a readiness document from another. The
  // replacement writes one generation directory and switches a single pointer,
  // and it is qualified against injected crashes in `corpus_publish.test.ts`.
  //
  // Kept as a marker rather than deleted silently: a reader looking for the old
  // commit path deserves to be told where the guarantee moved to, and why it is
  // a different guarantee rather than the same one relocated.
  it("has moved to corpus_publish, where the whole set switches at once", async () => {
    const session = await import("../src/corpus_session");
    expect(session).not.toHaveProperty("commitCorpusOutputs");
    const publish = await import("../src/corpus_publish");
    expect(publish.publishCorpusGeneration).toBeTypeOf("function");
  });
});
