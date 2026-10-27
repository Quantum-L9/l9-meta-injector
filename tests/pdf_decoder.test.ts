// pdf_decoder.test.ts — the PDF decoder against hostile and structured input.
//
// document_decoders.test.ts proves the PDF decoder reads the documents the
// fixtures write. This suite proves the parts of the contract that only show up
// at the edges: a document cannot spend unbounded memory or time, and a refusal
// names the real reason. Each case is a real PDF assembled from its own bytes.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_DECODER_BUDGET,
  DecodeInput,
  DecodeOutcome,
  DecoderBudget,
  pdfDecoder,
  pdfInternals,
} from "../src/documents";
import { runCorpusScan } from "../src/corpus_scan";
import {
  PdfFixtureObject,
  buildPdf,
  flateStreamObject,
  multiPagePdf,
  plainStreamObject,
  textContent,
  writeBytes,
} from "./helpers/document_fixtures";

const scratch: string[] = [];
function tmp(prefix = "l9-pdf-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

const MiB = 1024 * 1024;

/** Decode PDF bytes as the corpus does, under a chosen budget. */
function decodePdf(bytes: Buffer, budget: DecoderBudget = DEFAULT_DECODER_BUDGET): DecodeOutcome {
  const absolutePath = writeBytes(path.join(tmp(), "document.pdf"), bytes);
  const input: DecodeInput = {
    artifactId: "vsrc:test",
    contentHash: `sha256:${"b".repeat(64)}`,
    sourcePath: "document.pdf",
    absolutePath,
    sizeBytes: bytes.length,
    bytes,
    budget,
  };
  return pdfDecoder.decode(input);
}

function texts(outcome: DecodeOutcome): string[] {
  return outcome.decoded ? outcome.document.blocks.map((block) => block.text) : [];
}

/** A page whose content stream is a deflate bomb of `size` spaces. */
function bombPage(size: number): { object: (number: number) => PdfFixtureObject } {
  return { object: (number) => flateStreamObject(number, Buffer.alloc(size, 0x20)) };
}

/** A budget whose per-stream ceiling binds before the document ratio does. */
const SMALL_STREAMS: DecoderBudget = {
  ...DEFAULT_DECODER_BUDGET,
  maxPartBytes: 1 * MiB,
  maxCompressionRatio: 1_000_000,
};

/** A Type0 page showing `shown`, whose font's ToUnicode is object 6. */
function type0Pdf(cmap: string, shown: string): Buffer {
  return buildPdf(
    [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      },
      flateStreamObject(4, `BT /F1 12 Tf 72 720 Td ${shown} Tj ET`),
      {
        number: 5,
        body: "<< /Type /Font /Subtype /Type0 /BaseFont /Sub+Font /Encoding /Identity-H /ToUnicode 6 0 R >>",
      },
      plainStreamObject(6, cmap),
    ],
    { trailer: "/Size 7 /Root 1 0 R" },
  );
}

function cmapText(body: string[]): string {
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    ...body,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
}

describe("WU-057 the PDF decoder's resource bounds", () => {
  it("REG-WU-057-RC-114-114-a: refuses an over-budget content stream as budget_exceeded, not unsupported", () => {
    const outcome = decodePdf(multiPagePdf([bombPage(4 * MiB)]), SMALL_STREAMS);
    expect(outcome.decoded).toBe(false);
    if (outcome.decoded) return;
    expect(outcome.reason).toBe("decoder.budget_exceeded");
    // The ceiling the stream ran into is the 1 MiB per-stream one, enforced by
    // zlib: nothing larger was produced.
    const named = outcome.diagnostics.find((entry) => entry.part === "object 5");
    expect(named?.code).toBe("decoder.budget_exceeded");
    expect(named?.message).toContain(`${1 * MiB}-byte per-stream ceiling`);
  });

  it("REG-WU-057-RC-114-114-b: keeps page 1's text and names page 2's skipped stream", () => {
    const outcome = decodePdf(
      multiPagePdf([textContent(["Roadmap: ship Q3"]), bombPage(4 * MiB)]),
      SMALL_STREAMS,
    );
    expect(outcome.decoded).toBe(true);
    if (!outcome.decoded) return;
    expect(texts(outcome)).toEqual(["Roadmap: ship Q3"]);
    const budget = outcome.document.diagnostics.filter((entry) => entry.code === "decoder.budget_exceeded");
    expect(budget).toHaveLength(1);
    expect(budget[0]?.severity).toBe("warning");
    expect(budget[0]?.part).toBe("object 7");
    expect(outcome.document.diagnostics.some((entry) => entry.code === "decoder.ocr_required")).toBe(false);
  });

  it("REG-WU-057-RC-114-114-c: stops inflating at the document's aggregate allowance", () => {
    // Twelve streams of 600 KiB each: every one is under the 1 MiB per-stream
    // ceiling, and together they are far over the 4 MiB document allowance.
    const pages = [textContent(["Plan of record"]), ...Array.from({ length: 12 }, () => bombPage(600 * 1024))];
    const outcome = decodePdf(multiPagePdf(pages), SMALL_STREAMS);
    expect(outcome.decoded).toBe(true);
    if (!outcome.decoded) return;
    expect(texts(outcome)).toEqual(["Plan of record"]);
    const allowance = outcome.document.diagnostics.find((entry) =>
      entry.code === "decoder.budget_exceeded" && entry.message.includes("allowance"));
    expect(allowance?.message).toContain(`allowance of ${4 * MiB} bytes was exhausted`);
    // 4 MiB of allowance covers six 600 KiB streams; the rest were never inflated.
    const skipped = Number(/(\d+) stream\(s\) were not inflated/.exec(allowance?.message ?? "")?.[1]);
    expect(skipped).toBeGreaterThanOrEqual(5);
  });

  it("REG-WU-057-RC-114-114-d: decodes a legitimate multi-megabyte content stream in full", () => {
    // Varied text, so it compresses like prose rather than like a bomb.
    const lines = Array.from({ length: 42_000 }, (_, index) =>
      `Line ${index} records milestone ${(index * 7919) % 100_003} for workstream ${(index * 104_729) % 9973} as planned`);
    const content = textContent(lines);
    expect(content.length).toBeGreaterThan(3 * MiB);
    const outcome = decodePdf(multiPagePdf([content]));
    expect(outcome.decoded).toBe(true);
    if (!outcome.decoded) return;
    expect(outcome.document.blocks).toHaveLength(lines.length);
    expect(texts(outcome).at(-1)).toBe(lines.at(-1));
    expect(outcome.document.diagnostics.some((entry) => entry.code === "decoder.budget_exceeded")).toBe(false);
    expect(outcome.document.diagnostics.some((entry) => entry.code === "decoder.truncated")).toBe(false);
  });

  it("REG-WU-057-RC-114-114-e: still treats a corrupt Flate stream as unreadable, not over budget", () => {
    const corrupt = {
      object: (number: number): PdfFixtureObject => ({
        number,
        body: "<< /Length __LENGTH__ /Filter /FlateDecode >>",
        stream: Buffer.from("this is not a zlib stream at all", "latin1"),
      }),
    };
    const outcome = decodePdf(multiPagePdf([corrupt]), SMALL_STREAMS);
    expect(outcome.decoded).toBe(false);
    if (outcome.decoded) return;
    expect(outcome.reason).toBe("decoder.unsupported_feature");
    expect(outcome.diagnostics.some((entry) => entry.code === "decoder.budget_exceeded")).toBe(false);
  });

  it("REG-WU-057-RC-114-114-f: stores 300 full-width bfrange rows as ranges, quickly and without throwing", () => {
    const rows = Array.from({ length: 300 }, (_, index) => {
      const low = (index * 65_536).toString(16).padStart(8, "0");
      const high = (index * 65_536 + 65_535).toString(16).padStart(8, "0");
      return `<${low}> <${high}> <0041>`;
    });
    const cmap = cmapText(["300 beginbfrange", ...rows, "endbfrange"]);

    const started = Date.now();
    const outcome = decodePdf(type0Pdf(cmap, "<0001>"));
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(1000);
    expect(outcome.decoded).toBe(true);
    expect(texts(outcome)).toEqual(["B"]);

    // The ranges still answer for codes inside them, far past where one map
    // entry per code could have reached.
    const parsed = pdfInternals.parseToUnicode(cmap);
    expect(parsed.get(5 * 65_536 + 2)).toBe("C");
    expect(parsed.get(299 * 65_536 + 25)).toBe("Z");
    expect(parsed.get(300 * 65_536)).toBeUndefined();
  });

  it("REG-WU-057-RC-114-114-g: maps a normal CMap exactly as before, later rows winning", () => {
    const cmap = cmapText([
      "2 beginbfchar",
      "<0003> <004F>",
      "<0010> <0058>",
      "endbfchar",
      "2 beginbfrange",
      "<0004> <0006> <004B>",
      "<0005> <0005> <0021>",
      "endbfrange",
      "1 beginbfrange",
      "<0010> <0011> <0061>",
      "endbfrange",
    ]);
    const parsed = pdfInternals.parseToUnicode(cmap);
    expect(parsed.get(0x03)).toBe("O");
    expect(parsed.get(0x04)).toBe("K");
    // The later row covering <0005> wins over the earlier one, as Map.set did.
    expect(parsed.get(0x05)).toBe("!");
    expect(parsed.get(0x06)).toBe("M");
    // A bfrange row overrides a bfchar row for the same code.
    expect(parsed.get(0x10)).toBe("a");
    expect(parsed.get(0x11)).toBe("b");
    expect(parsed.get(0x07)).toBeUndefined();

    expect(texts(decodePdf(type0Pdf(cmap, "<000300040005>")))).toEqual(["OK!"]);
  });

  it("REG-WU-057-RC-114-114-h: decodes a 4,000-page PDF in time linear in its size", () => {
    const pages = Array.from({ length: 4000 }, (_, index) => textContent([`Page ${index + 1} body`]));
    const bytes = multiPagePdf(pages);
    expect(bytes.length).toBeGreaterThan(500_000);

    const started = Date.now();
    const outcome = decodePdf(bytes);
    const elapsed = Date.now() - started;
    expect(outcome.decoded).toBe(true);
    if (!outcome.decoded) return;
    expect(outcome.document.blocks).toHaveLength(4000);
    // About 17 s before the fix; well under a second after. The bound leaves
    // generous headroom for a slow CI runner.
    expect(elapsed).toBeLessThan(3000);
  });

  it("REG-WU-057-RC-114-114-i: a deflate-bomb PDF is a typed refusal and the scan carries on", async () => {
    const root = tmp("l9-pdf-corpus-");
    const bomb = multiPagePdf([bombPage(40 * MiB)]);
    expect(bomb.length).toBeLessThan(64 * 1024);
    writeBytes(path.join(root, "bomb.pdf"), bomb);
    fs.writeFileSync(path.join(root, "notes.md"), "# Notes\n\nThe migration ships in Q3.\n", "utf8");

    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });

    const pdf = result.documentSignals.formats.find((entry) => entry.format === "pdf");
    expect(pdf?.eligible_count).toBe(1);
    expect(pdf?.decoded_count).toBe(0);
    expect(pdf?.refusals).toEqual([{ name: "decoder.budget_exceeded", count: 1 }]);
    const markdown = result.documentSignals.formats.find((entry) => entry.format === "markdown");
    expect(markdown?.decoded_count).toBe(1);
  });

  it("deflates with a real zlib stream in the fixtures", () => {
    // Guard on the helpers the cases above rely on: a bomb is what it claims.
    const object = flateStreamObject(9, Buffer.alloc(1000, 0x20));
    expect(zlib.inflateSync(object.stream as Buffer).length).toBe(1000);
  });
});
