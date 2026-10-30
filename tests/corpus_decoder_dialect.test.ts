// corpus_decoder_dialect.test.ts — a decoder's dialect is part of what it decoded.
//
// The text decoder reads `.md` as Markdown and `.txt` as plain text; the CSV
// decoder splits `.tsv` on tabs and `.csv` on commas. Identical bytes under two
// such names are two different decoded documents, so they must have two cache
// entries and two normalized document ids — and identical bytes under one
// dialect must still share both, or duplicate content stops being decoded once.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CorpusCacheStats, MemoryCorpusCache, normalizedDocumentKey } from "../src/corpus_cache";
import { CorpusScanResult, runCorpusScan } from "../src/corpus_scan";
import { defaultDecoderRegistry } from "../src/documents";
import { writeDocx, writePdf } from "./helpers/document_fixtures";

const PRODUCER = "decoder-dialect";

const scratch: string[] = [];
function tmp(prefix = "l9-dialect-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

const MARKDOWN = [
  "# Launch Plan",
  "",
  "Status: blocked",
  "",
  "- wire the router",
  "- pick a region",
  "",
  "The launch is gated on procurement and on the platform team.",
  "",
].join("\n");

const TABLE = ["item\towner\tstatus", "router\tmel\tblocked", "region\tana\tdone", ""].join("\n");

function writeDialectCorpus(): string {
  const root = tmp();
  fs.writeFileSync(path.join(root, "a.md"), MARKDOWN, "utf8");
  fs.writeFileSync(path.join(root, "b.txt"), MARKDOWN, "utf8");
  fs.writeFileSync(path.join(root, "c.csv"), TABLE, "utf8");
  fs.writeFileSync(path.join(root, "d.tsv"), TABLE, "utf8");
  return root;
}

/** What each document was decoded as, and what its blocks said. */
function decodedView(result: CorpusScanResult) {
  const documents = result.documentIndex.documents
    .map((d) => ({
      path: d.root_relative_path,
      format: d.format,
      block_count: d.block_count,
      normalized_document_id: d.normalized_document_id,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const signals = result.documentWorkSignals.records
    .map((r) => `${r.source_path} ${r.predicate}=${r.object}`)
    .sort();
  return { documents, signals };
}

function layerStats(stats: CorpusCacheStats, layer: string) {
  return stats.layers.find((entry) => entry.layer === layer);
}

describe("identical bytes under two decoder dialects", () => {
  it("REG-WU-039-RC-067-a: decode the same with no cache, a cold cache and a warm one", async () => {
    const root = writeDialectCorpus();
    const roots = [{ path: root, name: "R" }];
    const cache = new MemoryCorpusCache(PRODUCER);

    const uncached = decodedView(await runCorpusScan({ roots, producerVersion: PRODUCER }));
    const cold = decodedView(await runCorpusScan({ roots, producerVersion: PRODUCER, cache }));
    const warm = decodedView(await runCorpusScan({ roots, producerVersion: PRODUCER, cache }));

    expect(cold).toEqual(uncached);
    expect(warm).toEqual(uncached);
    const byPath = new Map(uncached.documents.map((d) => [d.path, d]));
    expect(byPath.get("a.md")?.format).toBe("markdown");
    expect(byPath.get("b.txt")?.format).toBe("text");
    expect(byPath.get("a.md")?.block_count).not.toBe(byPath.get("b.txt")?.block_count);
    expect(byPath.get("d.tsv")?.format).toBe("csv");
    expect(byPath.get("d.tsv")?.block_count).not.toBe(byPath.get("c.csv")?.block_count);
    // The status cell exists only when the row is split on tabs.
    expect(warm.signals.some((s) => s.includes("d.tsv") && s.includes("work.status=blocked"))).toBe(true);
  });

  it("REG-WU-039-RC-067-b: decode the same however many decoders run at once", async () => {
    const root = writeDialectCorpus();
    const roots = [{ path: root, name: "R" }];
    const serial = decodedView(await runCorpusScan({
      roots, producerVersion: PRODUCER, cache: new MemoryCorpusCache(PRODUCER),
      budgets: { max_parallel_decoders: 1 },
    }));
    const parallel = decodedView(await runCorpusScan({
      roots, producerVersion: PRODUCER, cache: new MemoryCorpusCache(PRODUCER),
      budgets: { max_parallel_decoders: 8 },
    }));
    const uncached = decodedView(await runCorpusScan({ roots, producerVersion: PRODUCER }));
    expect(parallel).toEqual(serial);
    expect(serial).toEqual(uncached);
  });

  it("REG-WU-039-RC-067-d: carry different normalized document ids", async () => {
    const root = writeDialectCorpus();
    const result = await runCorpusScan({ roots: [{ path: root, name: "R" }], producerVersion: PRODUCER });
    const id = (name: string) =>
      result.documentIndex.documents.find((d) => d.root_relative_path === name)?.normalized_document_id;
    expect(id("a.md")).toBeTruthy();
    expect(id("a.md")).not.toBe(id("b.txt"));
    expect(id("c.csv")).not.toBe(id("d.tsv"));
    expect(result.documentIndex.summary.distinct_document_count).toBe(4);
  });
});

describe("identical bytes under one dialect", () => {
  it("REG-WU-039-RC-067-c: share one cache entry and one normalized document id", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "x.md"), MARKDOWN, "utf8");
    fs.writeFileSync(path.join(root, "y.md"), MARKDOWN, "utf8");
    const cache = new MemoryCorpusCache(PRODUCER);
    const result = await runCorpusScan({
      roots: [{ path: root, name: "R" }], producerVersion: PRODUCER, cache,
      budgets: { max_parallel_decoders: 1 },
    });
    // One entry: the first lookup misses and the second, under the same key, hits.
    // (The second document is still read, because its interpretation is filed
    // under its own path; re-storing the identical record is not a second entry.)
    const normalized = layerStats(result.cacheStats, "normalized_document");
    expect(normalized?.misses).toBe(1);
    expect(normalized?.hits).toBe(1);
    const ids = result.documentIndex.documents.map((d) => d.normalized_document_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(result.documentIndex.summary.distinct_document_count).toBe(1);
  });
});

describe("decoders that declare no dialect", () => {
  it("REG-WU-039-RC-067-e: keep the normalized document id computed without one", async () => {
    const root = tmp();
    writeDocx(path.join(root, "brief.docx"), { title: "Gamma", headings: ["Scope"], paragraphs: ["Status: draft"] });
    writePdf(path.join(root, "report.pdf"), ["Delta report", "Status: blocked"]);
    const result = await runCorpusScan({ roots: [{ path: root, name: "R" }], producerVersion: PRODUCER });
    const registry = defaultDecoderRegistry();
    for (const name of ["brief.docx", "report.pdf"]) {
      const entry = result.documentIndex.documents.find((d) => d.root_relative_path === name);
      const decoder = registry.forPath(name);
      expect(decoder?.dialectFor?.(name)).toBeUndefined();
      expect(entry?.normalized_document_id).toBe(normalizedDocumentKey({
        contentHash: entry?.content_hash as string,
        decoderId: decoder?.id as string,
        decoderVersion: decoder?.version as string,
      }));
    }
  });
});
