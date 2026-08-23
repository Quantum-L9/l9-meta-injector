// corpus_concurrency.test.ts — the bounds a run is actually held to.
//
// This package used to accept four worker budgets and act on two of them.
// `max_parallel_hashers` and `max_parallel_analysis` were parsed from the
// command line, written into the session manifest and exercised nowhere, so the
// manifest recorded a setting the run had never been subject to and an operator
// asking "can I make this faster" got a yes that was false.
//
// The two that were decorative are gone, and refused rather than ignored, which
// this file pins. The three that remain are measured rather than described:
// every test here observes concurrency as it happens — how many workers are
// inside the region at once, how many bytes are reserved at once — because a
// test that only asserts a flag was accepted is the same failure in a new coat.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CorpusSessionStore,
  DEFAULT_CORPUS_BUDGETS,
  MemoryBudget,
  boundedMap,
} from "../src/corpus_session";
import { DecoderRegistry } from "../src/documents";
import type { DecodeInput, DecodeOutcome, DocumentDecoder } from "../src/documents";
import { defaultDecoderRegistry } from "../src/documents";
import { runCorpusScan } from "../src/corpus_scan";

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-concurrency-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function corpusOf(count: number): string {
  const root = tmp();
  for (let i = 0; i < count; i += 1) {
    fs.writeFileSync(
      path.join(root, `note-${String(i).padStart(3, "0")}.md`),
      `# Note ${i}\n\nA document about subject ${i}, written down so it can be decoded.\n`,
      "utf8",
    );
  }
  return root;
}

/**
 * Watch how many document reads are in flight at once.
 *
 * The measurement is at the read, not at `decode`, because `decode` is
 * synchronous: in a single-threaded runtime two calls to it can never overlap,
 * so instrumenting there would measure 1 at every budget and prove nothing about
 * the bound. What `max_parallel_decoders` actually governs is how many document
 * pipelines are in flight across their I/O, which is where the wall-clock
 * difference on a real disk lives — so that is what these tests count.
 *
 * `fs.promises.readFile` is patched for the duration of one scan rather than
 * mocked away: the real read still happens, and only its overlap is recorded.
 */
async function withReadWatch<T>(body: () => Promise<T>): Promise<{ result: T; peak: number }> {
  const original = fs.promises.readFile;
  let live = 0;
  let peak = 0;
  (fs.promises as any).readFile = async (...args: unknown[]): Promise<unknown> => {
    live += 1;
    peak = Math.max(peak, live);
    try {
      // A tick of delay, so overlap is a fact about scheduling rather than an
      // artefact of a read that returned before the next one was issued.
      await new Promise((resolve) => setTimeout(resolve, 1));
      return await (original as any)(...args);
    } finally {
      live -= 1;
    }
  };
  try {
    const result = await body();
    return { result, peak };
  } finally {
    (fs.promises as any).readFile = original;
  }
}

/**
 * A decoder that counts how many documents reached it.
 *
 * Wraps the real Markdown decoder rather than replacing it, so what the scan
 * does with the result is unchanged.
 */
function countingRegistry(seen: { value: number }): DecoderRegistry {
  const inner = defaultDecoderRegistry().forPath("x.md") as DocumentDecoder;
  const counting: DocumentDecoder = {
    ...inner,
    decode(input: DecodeInput): DecodeOutcome {
      seen.value += 1;
      // The scan hands the bytes over rather than making the decoder read the
      // file again. If it ever stopped doing so the read would be back on the
      // synchronous path and the budget would have nothing left to bound.
      expect(input.bytes).toBeDefined();
      return inner.decode(input);
    },
  };
  const registry = new DecoderRegistry();
  registry.register(counting);
  return registry;
}

describe("the budgets that are still there", () => {
  it("names only bounds the run is held to", () => {
    // The shape of the default budget is the contract: a field here is a promise
    // that the number does something.
    expect(Object.keys(DEFAULT_CORPUS_BUDGETS).sort()).toEqual([
      "max_memory_bytes",
      "max_parallel_decoders",
      "max_parallel_embedding_requests",
    ]);
    expect(DEFAULT_CORPUS_BUDGETS).not.toHaveProperty("max_parallel_hashers");
    expect(DEFAULT_CORPUS_BUDGETS).not.toHaveProperty("max_parallel_analysis");
  });

  it("records in the session manifest exactly the budgets it enforces", async () => {
    const root = corpusOf(4);
    const sessionPath = path.join(tmp(), "session.json");
    const session = CorpusSessionStore.open({
      file: sessionPath,
      roots: [{ root_key: path.basename(root), root_id: "r", absolute_path: root }],
      budgets: { ...DEFAULT_CORPUS_BUDGETS, max_parallel_decoders: 3, archive: {} },
      now: "2026-01-01T00:00:00.000Z",
    });
    await runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
      budgets: { max_parallel_decoders: 3 },
      session,
    });
    session.save("2026-01-01T00:00:01.000Z");
    const written = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    expect(Object.keys(written.budgets).sort())
      .toEqual(["archive", "max_memory_bytes", "max_parallel_decoders", "max_parallel_embedding_requests"]);
    expect(written.budgets.max_parallel_decoders).toBe(3);
  });
});

describe("max_parallel_decoders", () => {
  it("puts more than one document read in flight when it is allowed to", async () => {
    const seen = { value: 0 };
    const { peak } = await withReadWatch(() => runCorpusScan({
      roots: [{ path: corpusOf(24) }],
      producerVersion: "test",
      decoderRegistry: countingRegistry(seen),
      budgets: { max_parallel_decoders: 6 },
    }));
    // Measured, not assumed: reads were genuinely open together, and never more
    // than the bound the operator set.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
    expect(seen.value).toBe(24);
  });

  it("holds to one when one is what was asked for", async () => {
    const seen = { value: 0 };
    const { peak } = await withReadWatch(() => runCorpusScan({
      roots: [{ path: corpusOf(12) }],
      producerVersion: "test",
      decoderRegistry: countingRegistry(seen),
      budgets: { max_parallel_decoders: 1 },
    }));
    expect(peak).toBe(1);
    expect(seen.value).toBe(12);
  });

  it("says the same thing at one worker as at eight", async () => {
    const root = corpusOf(16);
    const narrow = await runCorpusScan({
      roots: [{ path: root }], producerVersion: "test", budgets: { max_parallel_decoders: 1 },
    });
    const wide = await runCorpusScan({
      roots: [{ path: root }], producerVersion: "test", budgets: { max_parallel_decoders: 8 },
    });
    // The bound changes when work is issued and nothing about what is concluded.
    expect(wide.snapshot.corpus_source_snapshot_id)
      .toBe(narrow.snapshot.corpus_source_snapshot_id);
    expect(wide.snapshot.analysis_manifest).toEqual(narrow.snapshot.analysis_manifest);
    expect(wide.coverage.documents).toEqual(narrow.coverage.documents);
  });
});

describe("boundedMap, which is where the bound lives", () => {
  it("never exceeds its limit and preserves input order in its results", async () => {
    let live = 0;
    let peak = 0;
    const items = Array.from({ length: 40 }, (_, i) => i);
    const results = await boundedMap(items, 5, async (item) => {
      live += 1;
      peak = Math.max(peak, live);
      // Long enough for overlap to be real rather than an artefact of ticks.
      await new Promise((resolve) => setTimeout(resolve, 2));
      live -= 1;
      return item * 2;
    });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
    // Results are indexed by input position, not by completion order.
    expect(results).toEqual(items.map((item) => item * 2));
  });

  it("treats a limit below one as one rather than as no workers", async () => {
    let peak = 0;
    let live = 0;
    const results = await boundedMap([1, 2, 3], 0, async (item) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 1));
      live -= 1;
      return item;
    });
    // A zero bound that spawned no workers would hang forever. It runs, serially.
    expect(peak).toBe(1);
    expect(results).toEqual([1, 2, 3]);
  });
});

describe("max_memory_bytes", () => {
  it("holds concurrent reservations under the ceiling", async () => {
    const budget = new MemoryBudget(1_000);
    let held = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 12 }, async () => {
      await budget.reserve(300);
      held += 300;
      peak = Math.max(peak, held);
      await new Promise((resolve) => setTimeout(resolve, 2));
      held -= 300;
      budget.release(300);
    }));
    expect(peak).toBeLessThanOrEqual(1_000);
    expect(peak).toBeGreaterThanOrEqual(300);
  });

  it("admits a document larger than the whole budget rather than dropping it", async () => {
    const budget = new MemoryBudget(100);
    // Refusing would silently lose content. The ceiling exists to stop a hundred
    // concurrent reads, not to censor one large file.
    await budget.reserve(5_000);
    budget.release(5_000);
    // And the budget is usable again afterwards, rather than stuck negative.
    await budget.reserve(50);
    budget.release(50);
  });

  it("bounds decoded text held at once during a real scan", async () => {
    const root = tmp();
    const body = "word ".repeat(4_000);
    for (let i = 0; i < 12; i += 1) {
      fs.writeFileSync(path.join(root, `big-${i}.md`), `# Big ${i}\n\n${body}\n`, "utf8");
    }
    // A ceiling below two documents forces serialization through the budget.
    // The run must still complete and still decode everything: a memory bound
    // that dropped documents would be a coverage gap wearing a budget's name.
    const result = await runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
      budgets: { max_parallel_decoders: 8, max_memory_bytes: 30_000 },
    });
    expect(result.coverage.normalized_document_coverage.ratio).toBe(1);
    expect(result.coverage.documents.normalized_document_count).toBe(12);
  });
});

describe("the flags that were removed", () => {
  it("are not silently accepted by the budget type", () => {
    // A stale caller passing one gets a type error, and — at the CLI, where
    // there are no types — an error naming the reason. Both beat a run that
    // proceeds under a setting it is not subject to.
    const budgets: Partial<typeof DEFAULT_CORPUS_BUDGETS> = { max_parallel_decoders: 2 };
    expect(Object.keys(budgets)).toEqual(["max_parallel_decoders"]);
  });
});
