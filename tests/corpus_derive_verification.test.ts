// corpus_derive_verification.test.ts — derived layers come from the hashed bytes.
//
// Step 1 of a corpus scan hashes every file and that hash is the file's identity.
// Every derived layer — the normalized document, its lexical features, its
// interpretation, its declared identifier — is filed in the cache under a key
// computed from that hash. These tests pin the rule that makes that filing honest:
// a layer is derived only from bytes whose SHA-256 *is* that hash, and an
// outcome that describes the filesystem rather than the bytes (a file that
// vanished, a read that failed) is recorded for the run that saw it and never
// cached under a content key.
//
// The race is provoked deterministically. `runCorpusScan` hashes every root
// before its first `await`, and the derive stage reads a file only after one, so
// mutating a file between the call and the `await` changes it after it was
// hashed and before it is decoded — exactly the window a live disk opens.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  CORPUS_CACHE_ENTRY_SCHEMA,
  CorpusCacheLayer,
  CorpusCacheStats,
  MemoryCorpusCache,
} from "../src/corpus_cache";
import { CorpusScanResult, renderReadinessEvidence, runCorpusScan } from "../src/corpus_scan";
import { DecoderRegistry, defaultDecoderRegistry, docxDecoder } from "../src/documents";
import type { DocumentDecoder } from "../src/documents";
import { writeDocx, writePdf } from "./helpers/document_fixtures";
import { planDocument } from "./helpers/multi_root_fixtures";

const PRODUCER = "derive-verification";

const scratch: string[] = [];
function tmp(prefix = "l9-derive-verify-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function sha256(bytes: Buffer | string): string {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function writes(stats: CorpusCacheStats, layer: CorpusCacheLayer): number {
  return stats.layers.find((entry) => entry.layer === layer)?.writes ?? 0;
}

function hits(stats: CorpusCacheStats, layer: CorpusCacheLayer): number {
  return stats.layers.find((entry) => entry.layer === layer)?.hits ?? 0;
}

/** Everything a scan says about its documents, rendered so a string search covers it. */
function emittedEvidence(result: CorpusScanResult): string {
  return JSON.stringify({
    packets: result.rootPackets.map((root) => root.packet),
    readiness: result.readiness,
    candidates: result.candidates,
    documentIndex: result.documentIndex,
    documentSignals: result.documentSignals,
    workSignals: result.documentWorkSignals,
  });
}

/** Start a scan, change the source after it was hashed, then let the scan finish. */
async function scanThenMutate(
  input: Parameters<typeof runCorpusScan>[0],
  mutate: () => void,
): Promise<CorpusScanResult> {
  const pending = runCorpusScan(input);
  mutate();
  return pending;
}

const V1 = planDocument("Alpha");
const V2 = planDocument("Omega");

describe("a file rewritten between hashing and decoding", () => {
  it("REG-WU-038-RC-062-a/b: caches nothing under the hashed key, names the file, and poisons no later run", async () => {
    const r1 = tmp();
    const target = path.join(r1, "plan.md");
    fs.writeFileSync(target, V1, "utf8");
    const cache = new MemoryCorpusCache(PRODUCER);

    const raced = await scanThenMutate(
      { roots: [{ path: r1, name: "R1" }], producerVersion: PRODUCER, cache },
      () => fs.writeFileSync(target, V2, "utf8"),
    );

    // Step 1 is still the identity authority: the snapshot names the bytes it hashed.
    const artifact = raced.snapshot.artifacts.find((entry) => entry.root_relative_path === "plan.md");
    expect(artifact?.content_hash).toBe(sha256(V1));

    // Nothing derived from the rewritten bytes was filed under the old bytes' keys.
    for (const layer of ["normalized_document", "lexical_features", "interpretation"] as const) {
      expect(writes(raced.cacheStats, layer)).toBe(0);
    }
    // The run names the file, and no evidence quoting the new text is attributed to it.
    const changed = raced.diagnostics.filter((d) => d.code === "corpus.document_changed_during_scan");
    expect(changed.map((d) => d.corpus_path)).toEqual(["R1::plan.md"]);
    expect(changed[0]?.severity).toBe("warning");
    expect(emittedEvidence(raced)).not.toContain("Omega");
    const entry = raced.documentIndex.documents.find((d) => d.root_relative_path === "plan.md");
    expect(entry?.decoded).toBe(false);
    expect(entry?.undecoded_reason).toBe("changed_during_scan");
    expect(raced.coverage.documents.decode_gap.unaccounted).toBe(0);
    expect(raced.coverage.documents.decode_gap.other_refusal).toBe(1);

    // (b) A second root holding the hashed bytes reads the same warm as cold.
    const r2 = tmp();
    fs.writeFileSync(path.join(r2, "plan.md"), V1, "utf8");
    const warm = await runCorpusScan({ roots: [{ path: r2, name: "R2" }], producerVersion: PRODUCER, cache });
    const cold = await runCorpusScan({ roots: [{ path: r2, name: "R2" }], producerVersion: PRODUCER });
    expect(renderReadinessEvidence(warm.readiness)).toBe(renderReadinessEvidence(cold.readiness));
    expect(warm.documentIndex.documents.map((d) => d.normalized_content_hash))
      .toEqual(cold.documentIndex.documents.map((d) => d.normalized_content_hash));
    expect(warm.documentIndex.documents[0]?.decoded).toBe(true);
    expect(warm.rootPackets.map((root) => root.packet.semantic_hash))
      .toEqual(cold.rootPackets.map((root) => root.packet.semantic_hash));
    expect(emittedEvidence(warm)).not.toContain("Omega");
  });

  it("REG-WU-038-RC-062-c: refuses a container replaced after it was hashed", async () => {
    const root = tmp();
    const target = path.join(root, "plan.docx");
    writeDocx(target, { title: "Alpha Plan", headings: ["Scope"], paragraphs: ["Status: draft"] });
    const cache = new MemoryCorpusCache(PRODUCER);

    const raced = await scanThenMutate(
      { roots: [{ path: root, name: "R" }], producerVersion: PRODUCER, cache },
      () => writeDocx(target, { title: "Omega Plan", headings: ["Scope"], paragraphs: ["Status: done"] }),
    );

    expect(writes(raced.cacheStats, "normalized_document")).toBe(0);
    expect(raced.diagnostics.filter((d) => d.code === "corpus.document_changed_during_scan")
      .map((d) => d.corpus_path)).toEqual(["R::plan.docx"]);
    const entry = raced.documentIndex.documents.find((d) => d.root_relative_path === "plan.docx");
    expect(entry?.decoded).toBe(false);
    expect(entry?.undecoded_reason).toBe("changed_during_scan");
    expect(emittedEvidence(raced)).not.toContain("Omega");
    expect(raced.coverage.documents.decode_gap.unaccounted).toBe(0);
  });

  it("REG-WU-038-RC-062-c: refuses a container whose bytes move while it is being decoded", async () => {
    const root = tmp();
    const target = path.join(root, "plan.docx");
    writeDocx(target, { title: "Alpha Plan", headings: ["Scope"], paragraphs: ["Status: draft"] });
    // A decoder that reads the container and then, still inside the decode
    // window, has the file rewritten underneath it.
    const mutating: DocumentDecoder = {
      ...docxDecoder,
      decode(input) {
        const outcome = docxDecoder.decode(input);
        fs.appendFileSync(target, Buffer.from("trailing bytes"));
        return outcome;
      },
    };
    const registry = new DecoderRegistry();
    for (const decoder of defaultDecoderRegistry().all()) {
      registry.register(decoder.id === docxDecoder.id ? mutating : decoder);
    }
    const cache = new MemoryCorpusCache(PRODUCER);

    const result = await runCorpusScan({
      roots: [{ path: root, name: "R" }], producerVersion: PRODUCER, cache, decoderRegistry: registry,
    });

    expect(writes(result.cacheStats, "normalized_document")).toBe(0);
    expect(result.diagnostics.filter((d) => d.code === "corpus.document_changed_during_scan")
      .map((d) => d.corpus_path)).toEqual(["R::plan.docx"]);
    expect(result.coverage.documents.decode_gap.unaccounted).toBe(0);
  });

  it("REG-WU-038-RC-062-d: leaves a stable corpus fully warm, unopened and byte-identical", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "plan.md"), V1, "utf8");
    fs.writeFileSync(path.join(root, "notes.txt"), planDocument("Beta"), "utf8");
    writeDocx(path.join(root, "brief.docx"), { title: "Gamma", headings: ["Scope"], paragraphs: ["Status: draft"] });
    writePdf(path.join(root, "report.pdf"), ["Delta report", "Status: blocked"]);
    const roots = [{ path: root, name: "R" }];
    const cache = new MemoryCorpusCache(PRODUCER);

    const cold = await runCorpusScan({ roots, producerVersion: PRODUCER });
    await runCorpusScan({ roots, producerVersion: PRODUCER, cache });
    const readFile = vi.spyOn(fs.promises, "readFile");
    const warm = await runCorpusScan({ roots, producerVersion: PRODUCER, cache });

    expect(readFile).not.toHaveBeenCalled();
    expect(warm.cacheStats.misses).toBe(0);
    expect(warm.cacheStats.hit_ratio).toBe(1);
    expect(warm.diagnostics.some((d) => d.code === "corpus.document_changed_during_scan")).toBe(false);
    expect(renderReadinessEvidence(warm.readiness)).toBe(renderReadinessEvidence(cold.readiness));
    expect(JSON.stringify(warm.documentIndex.documents)).toBe(JSON.stringify(cold.documentIndex.documents));
  });
});

describe("encoding refusals stay cached, because they are facts about the bytes", () => {
  it("REG-WU-038-RC-062-f / REG-WU-038-RC-064-c: a Latin-1 Markdown file is refused once and never reopened", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "latin.md"), Buffer.from("# Caf\xe9 notes\n\nStatus: draft\n", "latin1"));
    const roots = [{ path: root, name: "R" }];
    const cache = new MemoryCorpusCache(PRODUCER);

    const first = await runCorpusScan({ roots, producerVersion: PRODUCER, cache });
    expect(writes(first.cacheStats, "normalized_document")).toBe(1);
    const entry = first.documentIndex.documents.find((d) => d.root_relative_path === "latin.md");
    expect(entry?.undecoded_reason).toBe("invalid");
    expect(first.coverage.documents.decode_gap.encoding_rejected).toBe(1);

    const readFile = vi.spyOn(fs.promises, "readFile");
    const warm = await runCorpusScan({ roots, producerVersion: PRODUCER, cache });
    expect(readFile).not.toHaveBeenCalled();
    expect(hits(warm.cacheStats, "normalized_document")).toBe(1);
    expect(warm.documentIndex.documents.find((d) => d.root_relative_path === "latin.md")?.undecoded_reason)
      .toBe("invalid");
  });
});

describe("a file that cannot be read", () => {
  it("REG-WU-038-RC-064-a/b: is reported for this run only and retried on the next", async () => {
    const r1 = tmp();
    const r2 = tmp();
    const text = planDocument("Kappa");
    fs.writeFileSync(path.join(r1, "a.md"), text, "utf8");
    fs.writeFileSync(path.join(r2, "different-name.md"), text, "utf8");
    const cache = new MemoryCorpusCache(PRODUCER);

    const vanished = await scanThenMutate(
      { roots: [{ path: r1, name: "r1" }], producerVersion: PRODUCER, cache },
      () => fs.unlinkSync(path.join(r1, "a.md")),
    );
    const unreadable = vanished.diagnostics.filter((d) => d.code === "corpus.document_unreadable");
    expect(unreadable.map((d) => d.corpus_path)).toEqual(["r1::a.md"]);
    expect(unreadable[0]?.severity).toBe("warning");
    expect(writes(vanished.cacheStats, "normalized_document")).toBe(0);
    expect(vanished.coverage.documents.decode_gap.other_refusal).toBe(1);
    expect(vanished.coverage.documents.decode_gap.unaccounted).toBe(0);
    expect(vanished.documentIndex.documents.find((d) => d.root_relative_path === "a.md")?.undecoded_reason)
      .toBe("unreadable");

    // (b) Restored, the same bytes decode on every path that holds them.
    fs.writeFileSync(path.join(r1, "a.md"), text, "utf8");
    const roots = [{ path: r1, name: "r1" }, { path: r2, name: "r2" }];
    const warm = await runCorpusScan({ roots, producerVersion: PRODUCER, cache });
    const cold = await runCorpusScan({ roots, producerVersion: PRODUCER });
    expect(warm.coverage.documents.normalized_document_count).toBe(2);
    expect(warm.coverage.documents.decoder_eligible_count).toBe(2);
    expect(warm.coverage.documents.normalized_document_count)
      .toBe(cold.coverage.documents.normalized_document_count);
    expect(renderReadinessEvidence(warm.readiness)).toBe(renderReadinessEvidence(cold.readiness));
    expect(warm.diagnostics.some((d) => d.code === "corpus.document_unreadable")).toBe(false);
  });

  it("REG-WU-038-RC-064-d: a whole-file document whose read fails is accounted for and named", async () => {
    const root = tmp();
    writePdf(path.join(root, "report.pdf"), ["Delta report", "Status: blocked"]);
    fs.writeFileSync(path.join(root, "plan.md"), V1, "utf8");

    const result = await scanThenMutate(
      { roots: [{ path: root, name: "R" }], producerVersion: PRODUCER, cache: new MemoryCorpusCache(PRODUCER) },
      () => fs.unlinkSync(path.join(root, "report.pdf")),
    );

    expect(result.coverage.documents.decode_gap.unaccounted).toBe(0);
    expect(result.diagnostics.filter((d) => d.code === "corpus.document_unreadable")
      .map((d) => d.corpus_path)).toEqual(["R::report.pdf"]);
    expect(writes(result.cacheStats, "normalized_document")).toBe(1);
  });
});

describe("the cache epoch", () => {
  it("is the second epoch", () => {
    expect(CORPUS_CACHE_ENTRY_SCHEMA).toBe("l9.corpus-cache-entry/v2");
  });
});
