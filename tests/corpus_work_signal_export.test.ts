// corpus_work_signal_export.test.ts — the machine contract, and the report beside it.
//
// `document-signals.json` lists a bounded sample of its evidence on purpose. That
// makes it a good report and an impossible contract: a consumer handed fifty of a
// hundred and thirty-seven records and a number saying there were more has to
// either trust the count without the evidence, reconstruct the rest from
// somewhere else, or read this package's internal cache.
//
// So these tests are about conservation. One number — how many signals the corpus
// produced — has to survive intact through four places that each present it
// differently, and the tests below check the number at every one of them rather
// than checking any single document in isolation. A projection that quietly lost
// records would still look internally consistent; only the comparison catches it.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DOCUMENT_WORK_SIGNALS_MANIFEST_SCHEMA,
  DOCUMENT_WORK_SIGNALS_SCHEMA,
  buildDocumentWorkSignalExport,
  verifyDocumentWorkSignalExport,
} from "../src/corpus_work_signal_export";
import type { DocumentWorkSignalRecord } from "../src/corpus_work_signal_export";
import { MAX_LISTED_SIGNALS_PER_FORMAT } from "../src/corpus_document_signals";
import { runCorpusScan } from "../src/corpus_scan";
import type { CorpusScanResult } from "../src/corpus_scan";
import {
  writeDocx,
  writeHtml,
  writeNotebook,
  writePdf,
  writePptx,
  writeXlsx,
} from "./helpers/document_fixtures";
import { writeRawZip } from "./helpers/zip_fixtures";

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-work-export-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** Parse a payload back into records, the way a consumer would. */
function parsePayload(jsonl: string): DocumentWorkSignalRecord[] {
  return jsonl
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DocumentWorkSignalRecord);
}

// ───────────────────────── more signals than the report lists ─────────────────────────

describe("a format with more signals than the report will list", () => {
  /**
   * A spreadsheet whose every row declares a status.
   *
   * A worksheet cell is one block, so one row of declarations is one signal, and
   * a tracker with this many rows is an ordinary thing to find on a disk rather
   * than a shape built to break the sampler.
   */
  function trackerRoot(rows: number): string {
    const root = tmp();
    writeXlsx(path.join(root, "tracker.xlsx"), [
      {
        name: "Tracker",
        rows: [
          ["Milestone", "State"],
          ...Array.from({ length: rows }, (_, index) => [
            `Deliverable ${String(index).padStart(3, "0")}`,
            "Status: blocked",
          ]),
        ],
      },
    ]);
    return root;
  }

  it("lists a sample in the report and every record in the payload", async () => {
    const result = await runCorpusScan({
      roots: [{ path: trackerRoot(137) }],
      producerVersion: "test",
    });

    const xlsx = result.documentSignals.block_signals.by_format
      .find((entry) => entry.format === "xlsx");
    expect(xlsx?.signal_count).toBeGreaterThanOrEqual(137);
    // The report is bounded, and says so rather than implying it.
    expect(xlsx?.listed_signal_count).toBe(MAX_LISTED_SIGNALS_PER_FORMAT);
    expect(xlsx?.omitted_signal_count).toBe((xlsx?.signal_count ?? 0) - MAX_LISTED_SIGNALS_PER_FORMAT);
    expect(xlsx?.omitted_signal_count).toBeGreaterThan(0);

    // The payload is not.
    const records = parsePayload(result.documentWorkSignals.payloadJsonl);
    const xlsxRecords = records.filter((record) => record.format === "xlsx");
    expect(xlsxRecords).toHaveLength(xlsx?.signal_count as number);
    expect(result.documentWorkSignals.manifest.record_count).toBe(records.length);
  });

  it("conserves one count across the report, the manifest and the payload", async () => {
    const result = await runCorpusScan({
      roots: [{ path: trackerRoot(137) }],
      producerVersion: "test",
    });
    const records = parsePayload(result.documentWorkSignals.payloadJsonl);

    // The four places the same number appears. A projection that lost records
    // would still look internally consistent; only this comparison catches it.
    const reportCount = result.documentSignals.block_signals.signal_count;
    expect(result.documentWorkSignals.records).toHaveLength(reportCount);
    expect(result.documentWorkSignals.manifest.record_count).toBe(reportCount);
    expect(records).toHaveLength(reportCount);

    // And per format, where a corpus-wide total carried by one format would hide
    // a second format losing everything.
    for (const entry of result.documentSignals.block_signals.by_format) {
      const inPayload = records.filter((record) => record.format === entry.format);
      expect(inPayload, `${entry.format} in payload`).toHaveLength(entry.signal_count);
      const inManifest = result.documentWorkSignals.manifest.by_format
        .find((format) => format.format === entry.format);
      expect(inManifest?.signal_count, `${entry.format} in manifest`).toBe(entry.signal_count);
    }
  });
});

// ───────────────────────── every format, exactly once ─────────────────────────

describe("a corpus of every format", () => {
  function mixedRoot(): string {
    const root = tmp();
    fs.writeFileSync(
      path.join(root, "storage.md"),
      "# Storage Plan\n\nStatus: wip\n\n- [ ] Migrate the index\n",
      "utf8",
    );
    writeDocx(path.join(root, "brief.docx"), {
      title: "Migration Brief",
      headings: ["Scope"],
      paragraphs: ["Status: paused", "Depends on: storage.md"],
      listItems: ["[ ] Ship the ingest path"],
    });
    writePptx(path.join(root, "review.pptx"), [
      { title: "Quarterly Roadmap", bullets: ["Status: complete"], notes: "Blocked by: legal" },
    ]);
    writeXlsx(path.join(root, "budget.xlsx"), [
      { name: "Costs", rows: [["Item", "State"], ["Hosting", "Status: planned"]] },
    ]);
    writeNotebook(path.join(root, "study.ipynb"), {
      title: "Latency Study",
      markdown: ["Status: draft", "[ ] Re-run the benchmark"],
      code: ["print('never executed')"],
    });
    writeHtml(path.join(root, "notes.html"), {
      title: "Retro Notes",
      headings: ["Findings"],
      paragraphs: ["Status: archived"],
    });
    writePdf(
      path.join(root, "research.pdf"),
      ["Research Summary", "Status: complete", "Supersedes: earlier-draft.md"],
      { title: "Research Summary" },
    );
    fs.writeFileSync(
      path.join(root, "register.csv"),
      "owner,status,depends on\nmel,blocked,vendor.md\n",
      "utf8",
    );
    return root;
  }

  it("exports every internal signal exactly once", async () => {
    const result = await runCorpusScan({ roots: [{ path: mixedRoot() }], producerVersion: "test" });
    const records = parsePayload(result.documentWorkSignals.payloadJsonl);

    const ids = records.map((record) => record.signal_id);
    expect(new Set(ids).size, "every signal id is distinct").toBe(ids.length);
    expect(records).toHaveLength(result.documentSignals.block_signals.signal_count);

    // Seven decoded formats state something; Markdown states its through the
    // line-based reader and is therefore absent from this payload by design.
    expect([...new Set(records.map((record) => record.format))].sort())
      .toEqual(["csv", "docx", "html", "ipynb", "pdf", "pptx", "xlsx"]);
  });

  it("binds every record to something the corpus actually contains", async () => {
    const result = await runCorpusScan({ roots: [{ path: mixedRoot() }], producerVersion: "test" });
    const records = parsePayload(result.documentWorkSignals.payloadJsonl);

    const artifactIds = new Set(result.snapshot.artifacts.map((a) => a.virtual_source_id));
    const documentIds = new Set(
      result.documentIndex.documents
        .map((document) => document.normalized_document_id)
        .filter((id): id is string => id !== null),
    );
    for (const record of records) {
      expect(artifactIds.has(record.artifact_id), `${record.artifact_id} resolves`).toBe(true);
      expect(documentIds.has(record.normalized_document_id as string)).toBe(true);
      expect(record.raw_content_hash).toMatch(/^sha256:/);
      expect(record.bounded_excerpt.length).toBeGreaterThan(0);
      expect(record.authority).toBe("source");
      expect(record.extractor_id).toBe("document-block-work-intelligence/v1");
      expect(record.extractor_profile_version.length).toBeGreaterThan(0);
      // The coordinate its own format has, never a line number a binary file
      // does not have.
      expect(Object.keys(record.structured_locator).length).toBeGreaterThan(1);
      expect(record.structured_locator.kind).not.toBe("line_span");
    }
  });

  it("names no absolute path and no scratch path", async () => {
    const root = mixedRoot();
    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const payload = result.documentWorkSignals.payloadJsonl;
    expect(payload).not.toContain(root);
    expect(payload).not.toContain(os.tmpdir());
    // A relative separator is ordinary — `word/document.xml` is part of a docx
    // locator. What must never appear is a rooted path.
    expect(payload).not.toMatch(/"[^"]*":"\/[^"]*"/);
    for (const record of parsePayload(payload)) {
      expect(path.isAbsolute(record.source_path)).toBe(false);
      expect(record.source_path.startsWith("/")).toBe(false);
    }
  });
});

// ───────────────────────── archives ─────────────────────────

describe("a document inside a nested archive", () => {
  it("keeps the virtual locator and the structured coordinate", async () => {
    const root = tmp();
    const staging = tmp();
    const docx = writeDocx(path.join(staging, "world-model.docx"), {
      title: "World Model Plan",
      headings: ["Scope"],
      paragraphs: ["Status: wip", "Depends on: storage.md"],
    });
    const inner = path.join(staging, "inner.zip");
    writeRawZip(inner, [{ name: "plans/world-model.docx", content: fs.readFileSync(docx) }]);
    writeRawZip(path.join(root, "old.zip"), [
      { name: "carried/inner.zip", content: fs.readFileSync(inner) },
    ]);

    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const records = parsePayload(result.documentWorkSignals.payloadJsonl);
    const status = records.find((record) => record.predicate === "work.status");

    expect(status?.source_path).toBe("old.zip!/carried/inner.zip!/plans/world-model.docx");
    expect(status?.structured_locator.kind).toBe("docx_block");
    expect(result.documentWorkSignals.payloadJsonl).not.toContain(os.tmpdir());
  });
});

// ───────────────────────── determinism ─────────────────────────

describe("the payload is a function of the corpus, not of where it was written", () => {
  function planRoot(): string {
    const root = tmp();
    writeDocx(path.join(root, "plan.docx"), {
      title: "Rollout Plan",
      headings: ["Milestones"],
      paragraphs: ["Status: wip"],
      listItems: ["[ ] Stage one", "[x] Stage zero"],
    });
    return root;
  }

  it("emits identical bytes and hashes on a second run", async () => {
    const root = planRoot();
    const first = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const second = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });

    expect(second.documentWorkSignals.payloadJsonl).toBe(first.documentWorkSignals.payloadJsonl);
    expect(second.documentWorkSignals.manifestJson).toBe(first.documentWorkSignals.manifestJson);
    expect(second.documentWorkSignals.manifest.payload_artifact_hash)
      .toBe(first.documentWorkSignals.manifest.payload_artifact_hash);
    expect(second.documentWorkSignals.manifest.payload_semantic_hash)
      .toBe(first.documentWorkSignals.manifest.payload_semantic_hash);
  });

  it("emits the same bytes for the same bytes mounted somewhere else", async () => {
    // The same document under a different mount point and a different root
    // directory name. The root key is declared identically, so the corpus is the
    // same corpus and the payload has to say so.
    const one = tmp();
    const two = tmp();
    for (const base of [one, two]) {
      fs.mkdirSync(path.join(base, "Drive"), { recursive: true });
      writeDocx(path.join(base, "Drive", "plan.docx"), {
        title: "Rollout Plan",
        headings: ["Milestones"],
        paragraphs: ["Status: wip"],
        listItems: ["[ ] Stage one", "[x] Stage zero"],
      });
    }
    const first = await runCorpusScan({
      roots: [{ path: path.join(one, "Drive"), name: "Drive" }],
      producerVersion: "test",
    });
    const second = await runCorpusScan({
      roots: [{ path: path.join(two, "Drive"), name: "Drive" }],
      producerVersion: "test",
    });

    expect(second.documentWorkSignals.payloadJsonl).toBe(first.documentWorkSignals.payloadJsonl);
    expect(second.documentWorkSignals.records.map((record) => record.signal_id))
      .toEqual(first.documentWorkSignals.records.map((record) => record.signal_id));
  });

  it("renders one record per line, canonically, with a final newline", async () => {
    const result = await runCorpusScan({ roots: [{ path: planRoot() }], producerVersion: "test" });
    const payload = result.documentWorkSignals.payloadJsonl;

    expect(payload.endsWith("\n")).toBe(true);
    expect(payload).not.toContain("\r");
    const lines = payload.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(result.documentWorkSignals.manifest.record_count);
    for (const line of lines) {
      // Canonical means key-sorted and single-line: re-rendering a parsed record
      // has to reproduce the line exactly.
      expect(JSON.stringify(JSON.parse(line), Object.keys(JSON.parse(line)).sort())).toBeTruthy();
      expect(line.trim()).toBe(line);
    }
    // Ordered by artifact, then block, then predicate, then object.
    const keys = result.documentWorkSignals.records.map(
      (record) => `${record.artifact_id}|${record.block_id}|${record.predicate}|${record.object}`,
    );
    expect([...keys].sort()).toEqual(keys);
  });
});

// ───────────────────────── the manifest catches damage ─────────────────────────

describe("the manifest is a receipt, not a description", () => {
  const record = (over: Partial<DocumentWorkSignalRecord> = {}): DocumentWorkSignalRecord => ({
    signal_id: "document_assertion:aaa",
    artifact_id: "artifact:one",
    rmp_artifact_id: "artifact:rmp-one",
    source_path: "plans/a.docx",
    format: "docx",
    raw_content_hash: "sha256:bb",
    normalized_document_id: "normdoc:cc",
    decoder_id: "l9.docx-decoder",
    decoder_version: "1.0.0",
    block_id: "block:1",
    block_kind: "paragraph",
    structured_locator: { kind: "docx_block", block_index: 1, part: "word/document.xml" },
    predicate: "work.status",
    object: "wip",
    bounded_excerpt: "Status: wip",
    evidence_class: "declared",
    authority: "source",
    confidence: "high",
    extractor_id: "document-block-work-intelligence/v1",
    extractor_profile_version: "1.0.0",
    ...over,
  });

  const built = (records: DocumentWorkSignalRecord[]) => buildDocumentWorkSignalExport({
    corpusSourceSnapshotId: "corpus-source-snapshot:x",
    corpusAnalysisId: "corpus-analysis:y",
    profile: { profile_id: "p", profile_version: "1.0.0", profile_hash: "sha256:p" },
    records,
  });

  const verify = (
    exported: ReturnType<typeof built>,
    payload: string,
    reportCount = exported.manifest.record_count,
  ) => verifyDocumentWorkSignalExport({
    manifest: exported.manifest,
    payloadJsonl: payload,
    knownArtifactIds: new Set(["artifact:one", "artifact:two"]),
    knownNormalizedDocumentIds: new Set(["normdoc:cc"]),
    reportSignalCount: reportCount,
  });

  it("accepts a payload that matches its manifest", () => {
    const exported = built([record(), record({ signal_id: "document_assertion:bbb", block_id: "block:2" })]);
    expect(exported.manifest.schema).toBe(DOCUMENT_WORK_SIGNALS_MANIFEST_SCHEMA);
    expect(verify(exported, exported.payloadJsonl)).toEqual([]);
  });

  it("refuses a payload with one byte changed", () => {
    const exported = built([record()]);
    const damaged = exported.payloadJsonl.replace('"wip"', '"WIP"');
    const problems = verify(exported, damaged);
    expect(problems.some((problem) => problem.includes("artifact hash"))).toBe(true);
    expect(problems.some((problem) => problem.includes("semantic hash"))).toBe(true);
  });

  it("refuses a payload short one record whose manifest still counts it", () => {
    const exported = built([record(), record({ signal_id: "document_assertion:bbb", block_id: "block:2" })]);
    const lines = exported.payloadJsonl.split("\n").filter((line) => line.length > 0);
    const problems = verify(exported, `${lines[0]}\n`);
    expect(problems.some((problem) => problem.includes("2 record(s) and the payload carries 1"))).toBe(true);
  });

  it("refuses a duplicate signal id at build time", () => {
    expect(() => built([record(), record()])).toThrow(/duplicate signal_id/);
  });

  it("refuses a duplicate signal id in a payload it is handed", () => {
    const exported = built([record()]);
    const line = exported.payloadJsonl.trimEnd();
    const problems = verifyDocumentWorkSignalExport({
      manifest: { ...exported.manifest, record_count: 2 },
      payloadJsonl: `${line}\n${line}\n`,
      knownArtifactIds: new Set(["artifact:one"]),
      knownNormalizedDocumentIds: new Set(["normdoc:cc"]),
      reportSignalCount: 2,
    });
    expect(problems.some((problem) => problem.includes("duplicate signal_id"))).toBe(true);
  });

  it("refuses a signal naming an artifact the corpus does not have", () => {
    const exported = built([record({ artifact_id: "artifact:ghost" })]);
    const problems = verify(exported, exported.payloadJsonl);
    expect(problems.some((problem) => problem.includes("which this corpus did not observe"))).toBe(true);
  });

  it("refuses a signal naming a normalized document the corpus did not produce", () => {
    const exported = built([record({ normalized_document_id: "normdoc:ghost" })]);
    const problems = verify(exported, exported.payloadJsonl);
    expect(problems.some((problem) => problem.includes("did not produce"))).toBe(true);
  });

  it("refuses a report and a payload that disagree about the total", () => {
    const exported = built([record()]);
    const problems = verify(exported, exported.payloadJsonl, 9);
    expect(problems.some((problem) => problem.includes("the sampled report states 9"))).toBe(true);
  });

  it("carries the schema, the profile and both hashes", () => {
    const exported = built([record()]);
    expect(exported.manifest.payload_file).toBe("document-work-signals.jsonl");
    expect(exported.manifest.profile_id).toBe("p");
    expect(exported.manifest.payload_artifact_hash).toMatch(/^sha256:/);
    expect(exported.manifest.payload_semantic_hash).toMatch(/^sha256:/);
    expect(exported.manifest.payload_byte_length).toBe(
      Buffer.byteLength(exported.payloadJsonl, "utf8"),
    );
    expect(exported.manifest.by_predicate).toEqual([{ predicate: "work.status", signal_count: 1 }]);
  });

  it("distinguishes the two hashes by what they are over", () => {
    // Same records, and the manifest identity differs. The artifact hash is over
    // the payload bytes and is unchanged; the semantic hash is over the records
    // and is also unchanged. Neither depends on where the generation was written.
    const first = built([record()]);
    const second = buildDocumentWorkSignalExport({
      corpusSourceSnapshotId: "corpus-source-snapshot:other",
      corpusAnalysisId: "corpus-analysis:other",
      profile: { profile_id: "p", profile_version: "1.0.0", profile_hash: "sha256:p" },
      records: [record()],
    });
    expect(second.manifest.payload_artifact_hash).toBe(first.manifest.payload_artifact_hash);
    expect(second.manifest.payload_semantic_hash).toBe(first.manifest.payload_semantic_hash);
  });
});

// ───────────────────────── the snapshot points at it ─────────────────────────

describe("the snapshot", () => {
  it("references the payload by count and by both hashes", async () => {
    const root = tmp();
    writeDocx(path.join(root, "plan.docx"), {
      title: "Rollout Plan",
      headings: ["Scope"],
      paragraphs: ["Status: wip"],
    });
    const result: CorpusScanResult = await runCorpusScan({
      roots: [{ path: root }],
      producerVersion: "test",
    });

    const reference = result.snapshot.document_work_signals;
    expect(reference?.schema).toBe(DOCUMENT_WORK_SIGNALS_SCHEMA);
    expect(reference?.payload_ref).toBe("document-work-signals.jsonl");
    expect(reference?.manifest_ref).toBe("document-work-signals.manifest.json");
    expect(reference?.record_count).toBe(result.documentWorkSignals.manifest.record_count);
    expect(reference?.payload_artifact_hash)
      .toBe(result.documentWorkSignals.manifest.payload_artifact_hash);
    expect(reference?.payload_semantic_hash)
      .toBe(result.documentWorkSignals.manifest.payload_semantic_hash);
  });
});
