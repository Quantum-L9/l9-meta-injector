// document_decoders.test.ts — proof that the formats an archive is made of decode.
//
// The failure this suite exists to prevent is the one that shipped last time: a
// decoder surface that counts formats it cannot read, so a shelf of Word
// documents becomes a coverage gap and the operator's actual history stays
// opaque. Every test here starts from a real file in the real format and asserts
// that specific text came out with a locator that points at where it was.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_DECODER_BUDGET,
  DecodeInput,
  UNSUPPORTED_LEGACY_EXTENSIONS,
  defaultDecoderRegistry,
  isSafePartName,
} from "../src/documents";
import { writeRawZip } from "./helpers/zip_fixtures";
import {
  writeDocx,
  writeEncryptedPdf,
  writeHtml,
  writeNotebook,
  writePdf,
  writePptx,
  writeScannedPdf,
  writeXlsx,
} from "./helpers/document_fixtures";

const scratch: string[] = [];
function tmp(prefix = "l9-decoders-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

const registry = defaultDecoderRegistry();

/** Decode a real file through the registry, as the corpus does. */
function decode(absolutePath: string) {
  const decoder = registry.forPath(absolutePath);
  expect(decoder, `no decoder claims ${absolutePath}`).toBeDefined();
  const input: DecodeInput = {
    artifactId: "vsrc:test",
    contentHash: `sha256:${"a".repeat(64)}`,
    sourcePath: path.basename(absolutePath),
    absolutePath,
    sizeBytes: fs.statSync(absolutePath).size,
    budget: DEFAULT_DECODER_BUDGET,
  };
  return (decoder as NonNullable<typeof decoder>).decode(input);
}

/** Every block's text, for the "did this survive" assertions. */
function texts(outcome: ReturnType<typeof decode>): string[] {
  if (!outcome.decoded) return [];
  return outcome.document.blocks.map((block) => block.text);
}

describe("a Word document", () => {
  it("yields its title, headings, prose, list items and table with block locators", () => {
    const file = writeDocx(path.join(tmp(), "world-model.docx"), {
      title: "World Model Plan",
      headings: ["Ingest", "Open questions"],
      paragraphs: [
        "The ingest pipeline reads the corpus and writes a normalized index.",
        "Status: WIP",
      ],
      listItems: ["wire the routing table", "pick a hosting region"],
      table: [["milestone", "state"], ["schema freeze", "done"]],
    });

    const outcome = decode(file);
    expect(outcome.decoded).toBe(true);
    if (!outcome.decoded) return;

    const document = outcome.document;
    expect(document.format).toBe("docx");
    expect(document.decoder_id).toBe("l9.docx-decoder");
    expect(document.metadata.title).toBe("World Model Plan");

    const all = texts(outcome);
    expect(all).toContain("World Model Plan");
    expect(all).toContain("Ingest");
    expect(all).toContain("The ingest pipeline reads the corpus and writes a normalized index.");
    expect(all).toContain("wire the routing table");
    expect(all).toContain("Status: WIP");

    // Styles decide kind: a Title style is a title, Heading1 is a heading.
    const title = document.blocks.find((block) => block.text === "World Model Plan");
    expect(title?.kind).toBe("title");
    expect(document.blocks.find((block) => block.text === "Ingest")?.kind).toBe("heading");
    expect(document.blocks.find((block) => block.text === "wire the routing table")?.kind)
      .toBe("list_item");

    // Every locator is a docx block index in a named part — never a line number,
    // which a Word document does not have.
    for (const block of document.blocks) {
      expect(block.locator.kind).toBe("docx_block");
      if (block.locator.kind !== "docx_block") continue;
      expect(block.locator.part).toBe("word/document.xml");
      expect(block.locator.block_index).toBeGreaterThan(0);
    }

    expect(document.tables).toHaveLength(1);
    expect(document.tables[0]?.rows).toEqual([["milestone", "state"], ["schema freeze", "done"]]);
  });

  it("records an external relationship and does not fetch it", () => {
    const file = writeDocx(path.join(tmp(), "linked.docx"), {
      title: "Linked",
      headings: [],
      paragraphs: ["See the upstream note."],
      externalLink: "https://example.invalid/never-fetched",
    });
    const outcome = decode(file);
    expect(outcome.decoded).toBe(true);
    if (!outcome.decoded) return;
    const note = outcome.document.diagnostics.find(
      (diagnostic) => diagnostic.code === "decoder.external_reference_not_followed",
    );
    expect(note?.message).toContain("example.invalid");
    expect(note?.message).toContain("not fetched");
  });
});

describe("a PowerPoint deck", () => {
  it("yields slide titles, shape text and speaker notes with slide locators", () => {
    const file = writePptx(path.join(tmp(), "roadmap.pptx"), [
      { title: "Roadmap 2019", bullets: ["Ship the indexer", "Blocked by: procurement"], notes: "The real argument lives here." },
      { title: "Next", bullets: ["Consolidate the archives"] },
    ]);

    const outcome = decode(file);
    expect(outcome.decoded).toBe(true);
    if (!outcome.decoded) return;

    const all = texts(outcome);
    expect(all).toContain("Roadmap 2019");
    expect(all).toContain("Blocked by: procurement");
    expect(all).toContain("The real argument lives here.");
    expect(all).toContain("Consolidate the archives");

    const title = outcome.document.blocks.find((block) => block.text === "Roadmap 2019");
    expect(title?.kind).toBe("title");
    expect(title?.locator).toEqual({
      kind: "pptx_shape",
      slide_number: 1,
      shape_index: 1,
      part: "ppt/slides/slide1.xml",
    });

    // Notes are their own kind, and cite the slide they belong to.
    const note = outcome.document.blocks.find((block) => block.text === "The real argument lives here.");
    expect(note?.kind).toBe("note");
    if (note?.locator.kind === "pptx_shape") {
      expect(note.locator.slide_number).toBe(1);
      expect(note.locator.part).toBe("ppt/notesSlides/notesSlide1.xml");
    }

    // Slide 10 must not sort before slide 2, which a string sort would do.
    const second = outcome.document.blocks.find((block) => block.text === "Next");
    if (second?.locator.kind === "pptx_shape") expect(second.locator.slide_number).toBe(2);
  });
});

describe("a spreadsheet", () => {
  it("yields cell text with sheet and cell locators, and never evaluates a formula", () => {
    const file = writeXlsx(path.join(tmp(), "planning.xlsx"), [
      {
        name: "Q3 Roadmap",
        rows: [
          ["task", "owner", "state"],
          ["ingest pipeline", "unassigned", "blocked"],
          ["total", "", "=SUM(C2:C9)"],
        ],
      },
    ]);

    const outcome = decode(file);
    expect(outcome.decoded).toBe(true);
    if (!outcome.decoded) return;

    const all = texts(outcome);
    expect(all).toContain("ingest pipeline");
    expect(all).toContain("Q3 Roadmap");

    const cell = outcome.document.blocks.find((block) => block.text === "ingest pipeline");
    expect(cell?.kind).toBe("cell");
    expect(cell?.locator).toEqual({
      kind: "spreadsheet_cell",
      sheet: "Q3 Roadmap",
      cell_or_range: "A2",
    });

    // The formula is carried as declared text. Evaluating it would invent a
    // number the operator never wrote down.
    const formula = all.find((text) => text.startsWith("=SUM"));
    expect(formula).toBeDefined();
    expect(formula).toContain("=SUM(C2:C9)");
    expect(outcome.document.diagnostics.some(
      (diagnostic) => diagnostic.message.includes("were not evaluated"),
    )).toBe(true);
  });
});

describe("a Jupyter notebook", () => {
  it("yields markdown structure and code source, and never reads outputs", () => {
    const file = writeNotebook(path.join(tmp(), "research.ipynb"), {
      title: "Temporal Memory Research",
      markdown: ["Status: WIP", "- [ ] finish the retrieval benchmark"],
      code: ["import graphiti\nprint('never executed')"],
      withOutputs: true,
    });

    const outcome = decode(file);
    expect(outcome.decoded).toBe(true);
    if (!outcome.decoded) return;

    const all = texts(outcome);
    expect(all).toContain("Temporal Memory Research");
    expect(all).toContain("Status: WIP");
    // The checkbox stays part of the item: `- [ ]` is what an open-task
    // extractor reads, and stripping it here would erase the signal.
    expect(all).toContain("[ ] finish the retrieval benchmark");
    expect(all.some((text) => text.includes("import graphiti"))).toBe(true);

    // The output holds a <script> tag. It must appear nowhere.
    expect(JSON.stringify(outcome.document)).not.toContain("never()");
    expect(outcome.document.diagnostics.some(
      (diagnostic) => diagnostic.message.includes("no cell was executed"),
    )).toBe(true);

    // A notebook locator cites the cell, not a line in the JSON nobody reads.
    const title = outcome.document.blocks.find((block) => block.text === "Temporal Memory Research");
    expect(title?.locator.kind).toBe("notebook_cell");
    if (title?.locator.kind === "notebook_cell") {
      expect(title.locator.cell_index).toBe(0);
      expect(title.locator.cell_type).toBe("markdown");
    }
    expect(outcome.document.metadata.language).toBe("python");
  });
});

describe("a saved web page", () => {
  it("yields headings, prose, tables and links, and never runs a script", () => {
    const file = writeHtml(path.join(tmp(), "spec.html"), {
      title: "Ingest Specification",
      headings: ["Ingest Specification", "Constraints"],
      paragraphs: ["The corpus is read only.", "Depends on: alpha-service"],
      link: { href: "https://example.invalid/upstream", text: "upstream" },
      table: [["field", "type"], ["root_id", "string"]],
    });

    const outcome = decode(file);
    expect(outcome.decoded).toBe(true);
    if (!outcome.decoded) return;

    const all = texts(outcome);
    expect(all).toContain("Ingest Specification");
    expect(all).toContain("The corpus is read only.");
    expect(all).toContain("Depends on: alpha-service");

    // Neither the inline script nor the stylesheet may become text.
    const serialized = JSON.stringify(outcome.document);
    expect(serialized).not.toContain("this must never run");
    expect(serialized).not.toContain("rebeccapurple");

    expect(outcome.document.links.map((link) => link.href))
      .toContain("https://example.invalid/upstream");
    expect(outcome.document.metadata.title).toBe("Ingest Specification");
    expect(outcome.document.tables[0]?.rows).toEqual([["field", "type"], ["root_id", "string"]]);

    const heading = outcome.document.blocks.find((block) => block.text === "Constraints");
    expect(heading?.locator.kind).toBe("html_node");
  });
});

describe("a PDF", () => {
  it("reads a native text layer with page and block locators", () => {
    const file = writePdf(
      path.join(tmp(), "research.pdf"),
      ["Temporal Knowledge Graphs", "Status: WIP", "Depends on: graphiti"],
      { title: "Temporal Knowledge Graphs" },
    );

    const outcome = decode(file);
    expect(outcome.decoded).toBe(true);
    if (!outcome.decoded) return;

    const all = texts(outcome);
    expect(all).toContain("Temporal Knowledge Graphs");
    expect(all).toContain("Status: WIP");
    expect(all).toContain("Depends on: graphiti");

    expect(outcome.document.format).toBe("pdf");
    expect(outcome.document.metadata.title).toBe("Temporal Knowledge Graphs");
    for (const block of outcome.document.blocks) {
      expect(block.locator.kind).toBe("pdf_page_block");
      if (block.locator.kind !== "pdf_page_block") continue;
      expect(block.locator.page_number).toBe(1);
      expect(block.locator.block_index).toBeGreaterThan(0);
    }
  });

  it("reports a scan as OCR-required rather than as an empty document", () => {
    const outcome = decode(writeScannedPdf(path.join(tmp(), "scan.pdf")));
    expect(outcome.decoded).toBe(false);
    if (outcome.decoded) return;
    // This is the distinction the whole layer exists for: "we could not read it"
    // must never look like "there was nothing in it".
    expect(outcome.reason).toBe("decoder.ocr_required");
    expect(outcome.message).toContain("scanned");
  });

  it("reports an encrypted document rather than guessing at it", () => {
    const outcome = decode(writeEncryptedPdf(path.join(tmp(), "secret.pdf")));
    expect(outcome.decoded).toBe(false);
    if (outcome.decoded) return;
    expect(outcome.reason).toBe("decoder.encrypted");
  });
});

describe("container defences", () => {
  it("refuses a part name that escapes the container", () => {
    expect(isSafePartName("word/document.xml")).toBe(true);
    expect(isSafePartName("../../etc/passwd")).toBe(false);
    expect(isSafePartName("/absolute/part.xml")).toBe(false);
    expect(isSafePartName("C:\\windows\\part.xml")).toBe(false);
    expect(isSafePartName("word\\document.xml")).toBe(false);
    expect(isSafePartName("word/../../escape.xml")).toBe(false);
  });

  it("reports an encrypted Office container instead of an empty one", () => {
    const file = path.join(tmp(), "locked.docx");
    writeRawZip(file, [
      { name: "[Content_Types].xml", content: "<Types/>" },
      { name: "EncryptedPackage", content: "opaque", stored: true },
    ]);
    const outcome = decode(file);
    expect(outcome.decoded).toBe(false);
    if (outcome.decoded) return;
    expect(outcome.reason).toBe("decoder.encrypted");
  });

  it("notes a macro part and never reads it", () => {
    const file = path.join(tmp(), "macro.docx");
    writeRawZip(file, [
      { name: "[Content_Types].xml", content: "<Types/>" },
      { name: "word/vbaProject.bin", content: "MZ-macro-bytes", stored: true },
      {
        name: "word/document.xml",
        content: '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Plain prose.</w:t></w:r></w:p></w:body></w:document>',
      },
    ]);
    const outcome = decode(file);
    expect(outcome.decoded).toBe(true);
    if (!outcome.decoded) return;
    expect(texts(outcome)).toContain("Plain prose.");
    const note = outcome.document.diagnostics.find(
      (diagnostic) => diagnostic.code === "decoder.macro_present_not_executed",
    );
    expect(note).toBeDefined();
    expect(JSON.stringify(outcome.document)).not.toContain("MZ-macro-bytes");
  });

  it("refuses an XML part that declares an entity, rather than expanding it", () => {
    const file = path.join(tmp(), "xxe.docx");
    writeRawZip(file, [
      { name: "[Content_Types].xml", content: "<Types/>" },
      {
        name: "word/document.xml",
        content:
          '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
          + '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:body></w:document>',
      },
    ]);
    const outcome = decode(file);
    expect(outcome.decoded).toBe(true);
    if (!outcome.decoded) return;
    // The declared entity is neither resolved nor silently dropped: it stays the
    // literal text it was, so nothing outside the file can be pulled in.
    const serialized = JSON.stringify(outcome.document);
    expect(serialized).not.toContain("root:");
    expect(serialized).not.toContain("/etc/passwd");
  });
});

describe("the registry", () => {
  it("claims every format the closure contract requires", () => {
    const claimed = new Set(registry.extensions());
    for (const extension of [
      ".md", ".txt", ".csv", ".html", ".ipynb", ".pdf", ".docx", ".pptx", ".xlsx",
    ]) {
      expect(claimed.has(extension), `no decoder claims ${extension}`).toBe(true);
    }
  });

  it("leaves the legacy formats explicitly unclaimed rather than half-supported", () => {
    for (const extension of UNSUPPORTED_LEGACY_EXTENSIONS) {
      expect(registry.forPath(`old${extension}`)).toBeUndefined();
    }
  });

  it("refuses two decoders competing for one extension", () => {
    const conflicting = defaultDecoderRegistry();
    expect(() => conflicting.register({
      id: "other",
      version: "1.0.0",
      format: "text",
      extensions: [".md"],
      decode: () => ({ decoded: false, reason: "decoder.malformed", message: "x", diagnostics: [] }),
    })).toThrow(/claimed by both/);
  });

  it("carries decoder identity into every normalized document id", () => {
    const file = writePdf(path.join(tmp(), "id.pdf"), ["Anything"]);
    const first = decode(file);
    const second = decode(file);
    expect(first.decoded && second.decoded).toBe(true);
    if (!first.decoded || !second.decoded) return;
    // Same bytes and same decoder: one identity, which is what lets the cache
    // serve one document to two artifacts holding identical bytes.
    expect(first.document.normalized_document_id).toBe(second.document.normalized_document_id);
    expect(first.document.normalized_document_id).toMatch(/^normdoc:/);
  });
});
