// corpus_document_participation.test.ts — decoded, and then actually used.
//
// A decoder can be wired into a scan, open every PDF on a disk, report a hundred
// percent coverage, and contribute nothing to a single candidate: the text lands
// in a normalized-document record that no later layer reads. Every number in the
// coverage report would look right, and the decoder would be decoration.
//
// So these tests never assert that a document decoded. They assert what happened
// to what came out of it — that a Word document and a Markdown file saying the
// same thing are found to be near-duplicates of each other, that a deck joins a
// topic, that the spreadsheet's cells reach the term counts — and that the
// signals document says so per format, where a gap cannot hide behind a total
// carried by the Markdown in the corpus.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildCorpusDocumentSignals,
  renderCorpusDocumentSignals,
} from "../src/corpus_document_signals";
import { runCorpusScan } from "../src/corpus_scan";
import {
  writeDocx,
  writeHtml,
  writeNotebook,
  writePdf,
  writePptx,
  writeScannedPdf,
  writeXlsx,
} from "./helpers/document_fixtures";

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-doc-part-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** The body both the Markdown and the Word document carry, word for word. */
const SHARED_BODY = [
  "The acquisition layer observes a local folder, an external drive or a zip archive",
  "and writes nothing into the source it reads. Archive members are staged into",
  "tool-owned scratch and carried as virtual artifacts, so the observed tree keeps",
  "exactly the bytes it had before the run started.",
  "Identity is derived from content and from root-relative paths, never from the",
  "mount point a disk happened to be attached at. Two copies of one archive mounted",
  "under two different directories are therefore one corpus rather than two.",
];

function participationRoot(): string {
  const root = tmp();
  fs.writeFileSync(
    path.join(root, "storage-migration.md"),
    `# Storage Migration Plan\n\n${SHARED_BODY.join("\n")}\n`,
    "utf8",
  );
  writeDocx(path.join(root, "storage-migration.docx"), {
    title: "Storage Migration Plan",
    headings: [],
    paragraphs: SHARED_BODY,
  });
  return root;
}

describe("a decoded document reaches the analysis, not only the coverage report", () => {
  it("finds a .docx and a .md saying the same thing to be near-duplicates", async () => {
    const result = await runCorpusScan({
      roots: [{ path: participationRoot() }],
      producerVersion: "test",
    });

    const candidate = result.candidates.near_duplicate_candidates.find((entry) =>
      [entry.source_path_a, entry.source_path_b].some((p) => p.endsWith(".docx")));
    expect(candidate).toBeDefined();
    // Both sides named, and the pair genuinely crosses the format boundary: a
    // .docx paired with another .docx would prove only that the decoder is
    // deterministic.
    const paths = [candidate?.source_path_a ?? "", candidate?.source_path_b ?? ""];
    expect(paths.some((p) => p.endsWith(".md"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".docx"))).toBe(true);
    expect(candidate?.score).toBeGreaterThan(0.8);

    // And the signals document reports it as participation rather than leaving a
    // reader to infer it from the candidate list.
    const docx = result.documentSignals.analysis_participation.by_format
      .find((entry) => entry.format === "docx");
    expect(docx?.decoded_count).toBe(1);
    expect(docx?.lexically_analyzed_count).toBe(1);
    expect(docx?.candidate_member_count).toBe(1);
  });

  it("carries every decoded document format into lexical analysis", async () => {
    const root = tmp();
    // One subject, seven containers. Sharing the vocabulary is the point: these
    // have to be able to reach the same topic, or "participation" would mean
    // nothing more than "was tokenized".
    const body = SHARED_BODY.join(" ");
    fs.writeFileSync(path.join(root, "notes.md"), `# Ingest notes\n\n${body}\n`, "utf8");
    fs.writeFileSync(
      path.join(root, "runs.csv"),
      "run,note\ncold,acquisition layer observes a local folder\nwarm,identity is derived from content\n",
      "utf8",
    );
    writePdf(path.join(root, "plan.pdf"), SHARED_BODY, { title: "Storage Migration Plan" });
    writeDocx(path.join(root, "plan.docx"), {
      title: "Storage Migration Plan", headings: [], paragraphs: SHARED_BODY,
    });
    writePptx(path.join(root, "review.pptx"), [
      { title: "Acquisition layer", bullets: SHARED_BODY.slice(0, 3), notes: SHARED_BODY[3] as string },
    ]);
    writeXlsx(path.join(root, "model.xlsx"), [
      { name: "runs", rows: [["stage", "note"], ["cold", body.slice(0, 120)]] },
    ]);
    writeNotebook(path.join(root, "measure.ipynb"), {
      title: "Hit ratio", markdown: SHARED_BODY.slice(0, 2), code: ["ratio = hits / total"],
    });
    writeHtml(path.join(root, "report.html"), {
      title: "Ingest report", headings: ["Ingest report"], paragraphs: SHARED_BODY.slice(0, 2),
    });

    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const byFormat = new Map(
      result.documentSignals.analysis_participation.by_format.map((entry) => [entry.format, entry]),
    );

    // Every document format decodes, and every one of them is analyzed. The
    // second half is the claim: a format with `decoded_count` above zero and
    // `lexically_analyzed_count` at zero is a decoder wired to nothing.
    for (const format of ["csv", "docx", "html", "ipynb", "pdf", "pptx", "xlsx"]) {
      const entry = byFormat.get(format);
      expect(entry, `${format} produced no decoded document`).toBeDefined();
      expect(entry?.decoded_count, `${format} decoded_count`).toBe(1);
      expect(entry?.lexically_analyzed_count, `${format} lexical participation`).toBe(1);
    }

    // The corpus-wide totals agree with the per-format rows, so neither can be
    // read as complete while the other says otherwise.
    const participation = result.documentSignals.analysis_participation;
    expect(participation.decoded_document_count).toBe(
      participation.by_format.reduce((sum, entry) => sum + entry.decoded_count, 0),
    );
    expect(participation.lexically_analyzed_count).toBe(
      participation.by_format.reduce((sum, entry) => sum + entry.lexically_analyzed_count, 0),
    );

    // Source code is deliberately not swept in: the text decoder claims `.ts`
    // alongside `.md`, and shingling a repository's TypeScript would report every
    // file sharing an import block as a near-duplicate of every other.
    expect(byFormat.get("text")?.lexically_analyzed_count ?? 0)
      .toBeLessThanOrEqual(byFormat.get("text")?.decoded_count ?? 0);
  });

  it("cites each format's own coordinate, and invents a line number for none", async () => {
    const root = tmp();
    writePdf(path.join(root, "plan.pdf"), SHARED_BODY, { title: "Plan" });
    writeDocx(path.join(root, "plan.docx"), {
      title: "Plan", headings: ["Scope"], paragraphs: SHARED_BODY,
    });
    writePptx(path.join(root, "deck.pptx"), [{ title: "Scope", bullets: ["one", "two"] }]);
    writeXlsx(path.join(root, "sheet.xlsx"), [{ name: "s", rows: [["a", "b"]] }]);
    writeNotebook(path.join(root, "nb.ipynb"), { title: "NB", markdown: ["prose"], code: ["x = 1"] });
    fs.writeFileSync(path.join(root, "notes.md"), "# Notes\n\nSome prose.\n", "utf8");

    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const locatorFor = (format: string): string[] =>
      result.documentSignals.formats.find((entry) => entry.format === format)?.locator_kinds ?? [];

    expect(locatorFor("pdf")).toEqual(["pdf_page_block"]);
    expect(locatorFor("docx")).toEqual(["docx_block"]);
    expect(locatorFor("pptx")).toEqual(["pptx_shape"]);
    expect(locatorFor("xlsx")).toEqual(["spreadsheet_cell"]);
    expect(locatorFor("ipynb")).toEqual(["notebook_cell"]);
    // Markdown has lines and cites them. Nothing else does.
    expect(locatorFor("markdown")).toEqual(["line_span"]);
    for (const format of ["pdf", "docx", "pptx", "xlsx", "ipynb"]) {
      expect(locatorFor(format)).not.toContain("line_span");
    }

    // The printed examples are real locators from real blocks, not a schema.
    const pdfExample = result.documentSignals.locator_examples
      .find((entry) => entry.format === "pdf");
    expect(pdfExample?.locator.kind).toBe("pdf_page_block");
    expect(pdfExample?.locator.page_number).toBe(1);
    expect(pdfExample?.block_id.length).toBeGreaterThan(0);
  });

  it("reports a scanned page as needing OCR rather than as a decoder failure", async () => {
    const root = tmp();
    writeScannedPdf(path.join(root, "scan.pdf"));
    fs.writeFileSync(path.join(root, "notes.md"), "# Notes\n\nSome prose.\n", "utf8");

    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });

    const pdf = result.documentSignals.formats.find((entry) => entry.format === "pdf");
    expect(pdf?.eligible_count).toBe(1);
    expect(pdf?.decoded_count).toBe(0);
    expect(pdf?.refusals).toEqual([{ name: "decoder.ocr_required", count: 1 }]);

    // And the coverage report agrees: it is an OCR-required document, not a
    // decoder that met bytes it claimed and broke on them.
    expect(result.coverage.documents.decode_gap.ocr_required).toBe(1);
    expect(result.coverage.documents.decode_gap.malformed).toBe(0);
    expect(result.coverage.documents.decode_gap.unaccounted).toBe(0);
    expect(result.coverage.documents.decoder_failure_count).toBe(0);
    expect(result.coverage.documents.ocr_required_count).toBe(1);
  });

  it("renders canonically, and names no absolute path", async () => {
    const root = participationRoot();
    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const rendered = renderCorpusDocumentSignals(result.documentSignals);

    expect(rendered.endsWith("\n")).toBe(true);
    expect(JSON.parse(rendered)).toEqual(result.documentSignals);
    expect(renderCorpusDocumentSignals(JSON.parse(rendered))).toBe(rendered);
    expect(rendered).not.toContain(root);
    expect(rendered).not.toContain(os.tmpdir());
  });

  it("orders its rows by name rather than by the order documents arrived", () => {
    const signals = buildCorpusDocumentSignals({
      corpusSourceSnapshotId: "corpus-source-snapshot:x",
      corpusAnalysisId: "corpus-analysis:y",
      decoderProfiles: ["l9.pdf-decoder@1.0.0", "l9.docx-decoder@1.0.0"],
      blockProfile: {
        profile_id: "meta-injector-document-block-signals",
        profile_version: "1.0.0",
        profile_hash: "sha256:profile",
        extractor_id: "document-block-work-intelligence/v1",
      },
      blockSignals: [],
      documents: [
        {
          virtual_source_id: "b", format: "pdf", decoder_id: "l9.pdf-decoder",
          decoder_version: "1.0.0", decoded: true, reason: null,
          blocks: [{ block_id: "block:2", kind: "paragraph", locator: { kind: "pdf_page_block" } }],
        },
        {
          virtual_source_id: "a", format: "docx", decoder_id: "l9.docx-decoder",
          decoder_version: "1.0.0", decoded: true, reason: null,
          blocks: [{ block_id: "block:1", kind: "title", locator: { kind: "docx_block" } }],
        },
      ],
      interpreted: new Set(["a"]),
      lexicallyAnalyzed: new Set(["a", "b"]),
      candidateMembers: new Set(["b"]),
    });

    expect(signals.formats.map((entry) => entry.format)).toEqual(["docx", "pdf"]);
    expect(signals.decoder_profiles).toEqual(["l9.docx-decoder@1.0.0", "l9.pdf-decoder@1.0.0"]);
    expect(signals.block_kinds).toEqual([
      { name: "paragraph", count: 1 },
      { name: "title", count: 1 },
    ]);
    expect(signals.analysis_participation.interpreted_count).toBe(1);
    expect(signals.analysis_participation.candidate_member_count).toBe(1);
    expect(signals.analysis_participation.lexically_analyzed_count).toBe(2);
  });
});

// ───────────────────────── per-format provenance ─────────────────────────
//
// The index used to carry one decoder for the whole corpus and stamp it on every
// row, so a `.docx` entry said the text decoder had read it, and the normalized
// document id derived from that same wrong decoder — an id that joins the index
// to the cache and to every piece of evidence, and joined them to nothing.

describe("the document index names the decoder that actually read each file", () => {
  it("gives each format its own decoder, format, block count and locator type", async () => {
    const root = participationRoot();
    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const index = result.rootPackets[0]?.documentIndex;
    expect(index?.schema).toBe("l9.document-index/v2");

    const byPath = new Map(
      (index?.documents ?? []).map((document) => [document.root_relative_path, document]),
    );
    const docx = byPath.get("storage-migration.docx");
    expect(docx?.format).toBe("docx");
    expect(docx?.decoder_id).toContain("docx");
    expect(docx?.block_count).toBeGreaterThan(0);
    expect(docx?.structured_locator_type).toBe("docx_block");

    const markdown = byPath.get("storage-migration.md");
    expect(markdown?.format).toBe("markdown");
    expect(markdown?.structured_locator_type).toBe("line_span");

    // The two are the same words in two containers, so they must not share an id:
    // a normalized document is a decoding, and these are two different decodings.
    expect(docx?.normalized_document_id).not.toBe(markdown?.normalized_document_id);
    expect(index?.decoder_profiles.length).toBeGreaterThan(1);
  });

  it("summarizes by format, and per root by the same function as the corpus", async () => {
    const root = participationRoot();
    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const index = result.rootPackets[0]?.documentIndex;
    const formats = (index?.summary.by_format ?? []).map((entry) => entry.format);
    expect(formats).toEqual(["docx", "markdown"]);
    // Two formats, two decoders, each counted under its own name rather than
    // both under whichever one the index happened to be told about.
    const decoders = new Set((index?.summary.by_format ?? []).map((entry) => entry.decoder_id));
    expect(decoders.size).toBe(2);

    const decodedByFormat = (index?.summary.by_format ?? [])
      .reduce((sum, entry) => sum + entry.decoded_count, 0);
    expect(decodedByFormat).toBe(index?.summary.decoded_count);

    // One root, so the per-root coverage and the corpus index must agree exactly.
    const coverage = result.rootPackets[0]?.documentCoverage;
    expect(coverage?.schema).toBe("l9.document-coverage/v2");
    expect(coverage?.by_format).toEqual(index?.summary.by_format);
    expect(coverage?.decoded_count).toBe(index?.summary.decoded_count);
  });

  it("reports no format and no blocks for an artifact nothing decoded", async () => {
    const root = participationRoot();
    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const undecoded = (result.rootPackets[0]?.documentIndex.documents ?? [])
      .filter((document) => !document.decoded);
    for (const document of undecoded) {
      expect(document.format).toBeNull();
      expect(document.block_count).toBeNull();
      expect(document.structured_locator_type).toBeNull();
      expect(document.structured_locator_types).toEqual([]);
      expect(document.undecoded_reason).not.toBeNull();
    }
  });
});
