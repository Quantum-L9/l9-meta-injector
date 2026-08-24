// corpus_document_work_signals.test.ts — what a document says, not only what it holds.
//
// Decoding a Word document made its text available. It did not make its
// *statements* available: `Status: blocked`, `- [x] shipped`, `Depends on:
// storage.md` are the sentences an operator's old plans are actually made of, and
// until the block reader existed they were read out of Markdown and out of
// nothing else. A corpus that finds three blocked projects among the `.md` files
// and none among the twenty `.docx` files beside them has not found three blocked
// projects; it has found the Markdown.
//
// Every test here therefore asserts a *claim* and the *coordinate* it was made
// at. The coordinate is the half that is easy to fake: a line number invented for
// a slide would satisfy any schema and point at nothing, so the assertions below
// require each format to cite its own — a slide and a shape, a sheet and a cell,
// a page and a block — and require that none of them is ever a line span.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readDocumentBlockSignals } from "../src/extractors/document_blocks";
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
import { treeSnapshot, writeRawZip } from "./helpers/zip_fixtures";

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-doc-signals-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** Every block-bound claim the run read, flattened. */
function signalsOf(result: CorpusScanResult): {
  predicate: string;
  object: string;
  format: string;
  locatorKind: string;
  locator: Record<string, unknown>;
  sourcePath: string;
  blockId: string;
  excerpt: string;
  rawHash: string | null;
  normalizedId: string | null;
  decoderId: string;
}[] {
  return result.documentSignals.block_signals.by_format.flatMap((entry) =>
    entry.records.map((record) => ({
      predicate: record.predicate,
      object: record.object,
      format: record.format,
      locatorKind: String(record.structured_locator.kind),
      locator: record.structured_locator,
      sourcePath: record.source_path,
      blockId: record.block_id,
      excerpt: record.bounded_excerpt,
      rawHash: record.raw_content_hash,
      normalizedId: record.normalized_document_id,
      decoderId: record.decoder_id,
    })));
}

function claim(
  result: CorpusScanResult,
  predicate: string,
  object: string,
): ReturnType<typeof signalsOf>[number] | undefined {
  return signalsOf(result).find(
    (signal) => signal.predicate === predicate && signal.object === object,
  );
}

// ───────────────────────── contract scenario 1 ─────────────────────────

describe("a Word plan inside a zip", () => {
  /** `old.zip!/plans/world-model.docx`, exactly as the contract names it. */
  function archivedPlanRoot(): string {
    const root = tmp();
    const staging = tmp();
    const docx = writeDocx(path.join(staging, "world-model.docx"), {
      title: "World Model Plan",
      headings: ["Milestones", "Open questions"],
      paragraphs: [
        "Status: wip",
        "Depends on: storage-migration.md",
        "The temporal assertion store is the piece everything else waits on.",
      ],
      listItems: ["[ ] Ship the ingest path", "[x] Draft the schema"],
    });
    writeRawZip(path.join(root, "old.zip"), [
      { name: "plans/world-model.docx", content: fs.readFileSync(docx) },
    ]);
    return root;
  }

  it("states its status, its dependency and its tasks, from inside the archive", async () => {
    const root = archivedPlanRoot();
    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });

    const status = claim(result, "work.status", "wip");
    expect(status).toBeDefined();
    // The provenance the contract asks for: the archive, the member, and the
    // decoding of exactly those bytes.
    expect(status?.sourcePath).toBe("old.zip!/plans/world-model.docx");
    expect(status?.rawHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(status?.normalizedId).toMatch(/^normdoc:/);
    expect(status?.decoderId).toContain("docx");
    expect(status?.locatorKind).toBe("docx_block");

    expect(claim(result, "work.depends_on", "storage-migration.md")).toBeDefined();
    expect(claim(result, "document.title", "World Model Plan")).toBeDefined();
    expect(claim(result, "document.heading", "Milestones")).toBeDefined();
    // A Word checklist carries its bullet in the numbering definition, not in the
    // text. Reading only `- [ ]` would find every Markdown task and no Word one.
    expect(claim(result, "work.task.open", "Ship the ingest path")).toBeDefined();
    expect(claim(result, "work.task.completed", "Draft the schema")).toBeDefined();
  });

  it("is eligible for candidate analysis, and is marked as having said something", async () => {
    const root = archivedPlanRoot();
    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });

    const docx = result.documentSignals.analysis_participation.by_format
      .find((entry) => entry.format === "docx");
    expect(docx?.decoded_count).toBe(1);
    // The number this whole layer exists to move off zero.
    expect(docx?.interpreted_count).toBe(1);
    expect(docx?.lexically_analyzed_count).toBe(1);
  });

  it("reaches readiness as an artifact with open tasks", async () => {
    const root = archivedPlanRoot();
    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });

    const evidence = result.readiness.artifact_evidence.find(
      (entry) => entry.corpus_path.endsWith("old.zip!/plans/world-model.docx"),
    );
    // The signals a Word plan should raise, and did not raise before the block
    // reader existed: the file was decoded and then said nothing to anybody.
    const signals = (evidence?.signals ?? []).map((signal) => signal.signal);
    expect(signals).toContain("artifact.has_open_tasks");
    expect(signals).toContain("artifact.has_plan");
    expect(result.coverage.semantics.work_signal_artifact_count).toBe(1);
  });

  it("leaves the archive exactly as it found it", async () => {
    const root = archivedPlanRoot();
    const before = treeSnapshot(root);
    await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    expect(treeSnapshot(root)).toEqual(before);
  });
});

// ───────────────────────── contract scenario 2 ─────────────────────────

describe("a strategy deck", () => {
  it("declares a roadmap from the slide that says so, at a slide and shape", async () => {
    const root = tmp();
    const staging = tmp();
    const pptx = writePptx(path.join(staging, "roadmap.pptx"), [
      { title: "Q3 Product Roadmap", bullets: ["Status: active"], notes: "Blocked by: legal review" },
      { title: "Delivery", bullets: ["[ ] Sign the hosting contract"] },
    ]);
    writeRawZip(path.join(root, "backup.zip"), [
      { name: "strategy/roadmap.pptx", content: fs.readFileSync(pptx) },
    ]);
    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });

    const roadmap = claim(result, "work.kind", "roadmap");
    expect(roadmap).toBeDefined();
    expect(roadmap?.locatorKind).toBe("pptx_shape");
    expect(roadmap?.locator.slide_number).toBe(1);
    expect(roadmap?.locator.shape_index).toBe(1);
    expect(roadmap?.sourcePath).toBe("backup.zip!/strategy/roadmap.pptx");

    // Speaker notes are part of what the deck says. They are also the place a
    // blocker is most often written down.
    const blocked = claim(result, "work.blocked_by", "legal review");
    expect(blocked?.locator.part).toContain("notesSlide");

    const task = claim(result, "work.task.open", "Sign the hosting contract");
    expect(task?.locator.slide_number).toBe(2);
  });
});

// ───────────────────────── contract scenario 4 ─────────────────────────

describe("a project tracker", () => {
  it("reads cells and cites sheet and cell, and never evaluates a formula", async () => {
    const root = tmp();
    writeXlsx(path.join(root, "planning.xlsx"), [
      {
        name: "Tracker",
        rows: [
          ["Milestone", "Notes"],
          ["Status: blocked", "=SUM(A1:A2)"],
          ["Depends on: vendor-contract.md", "carried over"],
        ],
      },
    ]);
    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });

    const status = claim(result, "work.status", "blocked");
    expect(status?.locatorKind).toBe("spreadsheet_cell");
    expect(status?.locator.sheet).toBe("Tracker");
    expect(status?.locator.cell_or_range).toBe("A2");

    expect(claim(result, "work.depends_on", "vendor-contract.md")?.locator.cell_or_range)
      .toBe("A3");

    // The formula is text the sheet contains, never a number this tool computed.
    const rendered = JSON.stringify(result.documentSignals);
    expect(rendered).not.toContain('"3"');
    expect(result.coverage.documents.decoder_failure_count).toBe(0);
  });
});

// ───────────────────────── a register is a table ─────────────────────────

describe("a comma-separated register", () => {
  it("reads a column's declaration and cites the row and the column", async () => {
    const root = tmp();
    fs.writeFileSync(
      path.join(root, "register.csv"),
      "owner,status,depends on\nmel,blocked,vendor-contract.md\nkim,active,\n",
      "utf8",
    );
    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });

    const blocked = claim(result, "work.status", "blocked");
    expect(blocked?.locatorKind).toBe("csv_row");
    expect(blocked?.locator.row_number).toBe(2);
    // The column, which the `csv_row` locator has always had room for and which
    // nothing set while the row was the smallest unit a reader could see.
    expect(blocked?.locator.column).toBe("status");

    const depends = claim(result, "work.depends_on", "vendor-contract.md");
    expect(depends?.locator.row_number).toBe(2);
    expect(depends?.locator.column).toBe("depends on");

    // The empty cell on row 3 declares nothing, and is not reported as declaring
    // an empty something.
    expect(claim(result, "work.depends_on", "")).toBeUndefined();
    expect(claim(result, "work.status", "active")?.locator.row_number).toBe(3);
  });
});

// ───────────────────────── every format, and no fake coordinates ─────────────────────────

describe("the coordinate each format actually has", () => {
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
      paragraphs: ["Status: paused"],
    });
    writePptx(path.join(root, "review.pptx"), [
      { title: "Quarterly Review", bullets: ["Status: complete"] },
    ]);
    writeXlsx(path.join(root, "budget.xlsx"), [
      { name: "Costs", rows: [["Status: planned"]] },
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
    return root;
  }

  it("cites a structured locator for every decoded format, and a line span for none", async () => {
    const result = await runCorpusScan({ roots: [{ path: mixedRoot() }], producerVersion: "test" });
    const signals = signalsOf(result);
    expect(signals.length).toBeGreaterThan(0);

    const kindsByFormat = new Map<string, Set<string>>();
    for (const signal of signals) {
      const kinds = kindsByFormat.get(signal.format) ?? new Set<string>();
      kinds.add(signal.locatorKind);
      kindsByFormat.set(signal.format, kinds);
    }
    expect([...kindsByFormat.get("docx") ?? []]).toEqual(["docx_block"]);
    expect([...kindsByFormat.get("pptx") ?? []]).toEqual(["pptx_shape"]);
    expect([...kindsByFormat.get("xlsx") ?? []]).toEqual(["spreadsheet_cell"]);
    expect([...kindsByFormat.get("html") ?? []]).toEqual(["html_node"]);
    expect([...kindsByFormat.get("pdf") ?? []]).toEqual(["pdf_page_block"]);
    // A notebook cell is the one structured locator that legitimately carries
    // line numbers: they are lines *of that cell*, which the file really has.
    expect([...kindsByFormat.get("ipynb") ?? []]).toEqual(["notebook_cell"]);

    // The invariant the whole design exists for: nothing decoded from a binary
    // container is given a line number in the file an operator would open.
    const lineSpans = signals.filter((signal) => signal.locatorKind === "line_span");
    expect(lineSpans).toEqual([]);
  });

  it("finds the same statement in every format that states it", async () => {
    const result = await runCorpusScan({ roots: [{ path: mixedRoot() }], producerVersion: "test" });
    const statusFormats = new Set(
      signalsOf(result)
        .filter((signal) => signal.predicate === "work.status")
        .map((signal) => signal.format),
    );
    expect([...statusFormats].sort())
      .toEqual(["docx", "html", "ipynb", "pdf", "pptx", "xlsx"]);

    // The Markdown file states one too, through the line-based reader, which is
    // why it is absent from the set above rather than missing from the corpus.
    expect(result.coverage.semantics.work_signal_artifact_count).toBe(7);
  });

  it("binds every claim to something a reader can open", async () => {
    const result = await runCorpusScan({ roots: [{ path: mixedRoot() }], producerVersion: "test" });
    for (const signal of signalsOf(result)) {
      expect(signal.sourcePath.length).toBeGreaterThan(0);
      expect(signal.rawHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(signal.normalizedId).toMatch(/^normdoc:/);
      expect(signal.blockId.length).toBeGreaterThan(0);
      expect(signal.excerpt.length).toBeGreaterThan(0);
      expect(signal.excerpt.length).toBeLessThanOrEqual(240);
      expect(Object.keys(signal.locator).length).toBeGreaterThan(1);
    }
  });

  it("never reads a notebook's code cell as prose", async () => {
    const result = await runCorpusScan({ roots: [{ path: mixedRoot() }], producerVersion: "test" });
    for (const signal of signalsOf(result)) {
      expect(signal.excerpt).not.toContain("never executed");
    }
  });

  it("names the rules that read the blocks, and moves the analysis identity", async () => {
    const result = await runCorpusScan({ roots: [{ path: mixedRoot() }], producerVersion: "test" });
    const evidence = result.documentSignals.block_signals;
    expect(evidence.profile_id).toBe("meta-injector-document-block-signals");
    expect(evidence.extractor_id).toBe("document-block-work-intelligence/v1");
    expect(evidence.profile_hash).toMatch(/^sha256:/);
    // A change to the vocabulary is a change to what was concluded, so the
    // conclusion's identity carries it.
    expect(result.snapshot.analysis.document_block_profile).toBe(evidence.profile_hash);
  });

  it("counts every claim it read, and says how many it listed", async () => {
    const result = await runCorpusScan({ roots: [{ path: mixedRoot() }], producerVersion: "test" });
    const evidence = result.documentSignals.block_signals;
    const listed = evidence.by_format.reduce((sum, entry) => sum + entry.listed_signal_count, 0);
    const omitted = evidence.by_format.reduce((sum, entry) => sum + entry.omitted_signal_count, 0);
    expect(listed + omitted).toBe(evidence.signal_count);
    for (const entry of evidence.by_format) {
      expect(entry.listed_signal_count + entry.omitted_signal_count).toBe(entry.signal_count);
      expect(entry.records).toHaveLength(entry.listed_signal_count);
    }
  });

  it("reads a corpus the same way twice", async () => {
    const root = mixedRoot();
    const first = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const second = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    expect(JSON.stringify(second.documentSignals)).toBe(JSON.stringify(first.documentSignals));
  });
});

// ───────────────────────── the reader in isolation ─────────────────────────

describe("the block reader", () => {
  const base = {
    subjectId: "artifact:x",
    sourcePath: "plans/a.docx",
    sourceContentHash: "sha256:aa",
    normalizedDocumentId: "normdoc:bb",
    decoderId: "l9.docx-decoder",
    decoderVersion: "1.0.0",
    format: "docx" as const,
  };
  const block = (
    block_id: string,
    kind: "title" | "heading" | "paragraph" | "list_item" | "code" | "cell",
    text: string,
    index: number,
  ) => ({
    block_id,
    kind,
    text,
    locator: { kind: "docx_block" as const, block_index: index, part: "word/document.xml" },
  });

  it("never reads a code block", () => {
    const signals = readDocumentBlockSignals({
      ...base,
      blocks: [block("b1", "code", "- [ ] not a task\nStatus: wip", 1)],
    });
    expect(signals).toEqual([]);
  });

  it("never reads a heading as a declaration", () => {
    const signals = readDocumentBlockSignals({
      ...base,
      blocks: [block("b1", "heading", "Status: blocked", 1)],
    });
    // The heading is reported as a heading and not as a status: a section called
    // "Status: Blocked" names a section.
    expect(signals.map((signal) => signal.predicate)).toEqual(["document.heading"]);
  });

  it("reads a milestone list under a Milestones heading", () => {
    const signals = readDocumentBlockSignals({
      ...base,
      blocks: [
        block("b1", "heading", "Milestones", 1),
        block("b2", "list_item", "Beta to ten customers", 2),
        block("b3", "list_item", "General availability", 3),
        block("b4", "paragraph", "Unrelated prose that ends the section.", 4),
        block("b5", "list_item", "Not a milestone", 5),
      ],
    });
    const milestones = signals
      .filter((signal) => signal.predicate === "work.milestone")
      .map((signal) => signal.object)
      .sort();
    expect(milestones).toEqual(["Beta to ten customers", "General availability"]);
  });

  it("refuses a claim whose evidence looks like a credential", () => {
    const signals = readDocumentBlockSignals({
      ...base,
      blocks: [block("b1", "paragraph", "Status: wip api_key: sk-01234567890abcdef", 1)],
    });
    expect(signals).toEqual([]);
  });

  it("counts one claim once when a block repeats it", () => {
    const signals = readDocumentBlockSignals({
      ...base,
      blocks: [block("b1", "cell", "Status: blocked\nStatus: blocked", 1)],
    });
    expect(signals).toHaveLength(1);
  });

  it("orders its output by source, block and predicate", () => {
    const signals = readDocumentBlockSignals({
      ...base,
      blocks: [
        block("b9", "paragraph", "Status: wip", 9),
        block("b2", "paragraph", "Depends on: other.md", 2),
      ],
    });
    expect(signals.map((signal) => signal.evidence.block_id)).toEqual(["b2", "b9"]);
  });

  it("survives a block whose text is empty", () => {
    const signals = readDocumentBlockSignals({
      ...base,
      blocks: [block("b1", "title", "", 1), block("b2", "paragraph", "   ", 2)],
    });
    expect(signals).toEqual([]);
  });
});
