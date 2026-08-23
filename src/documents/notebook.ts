// notebook.ts — Jupyter notebooks, read and never run.
//
// A notebook is JSON, so decoding it is easy and the hard part is restraint. A
// notebook carries source, outputs, and metadata; outputs can hold rendered HTML
// and base64 images, and executing a cell is a thing a naive "just evaluate it"
// reader could be talked into. This decoder reads `source` and reads nothing
// else that could execute.
//
// Cell indices are the notebook's own coordinate, so a locator cites a cell
// index and the line span inside that cell. Citing a line number in the raw
// `.ipynb` JSON would be technically true and useless: nobody reads the JSON.
import {
  BlockBuilder,
  DecodeInput,
  DecodeOutcome,
  DocumentDecoder,
  buildNormalizedDocument,
  normalizedDocumentId,
} from "./decoder";
import { readUtf8 } from "./text";

export const NOTEBOOK_DECODER_ID = "l9.ipynb-decoder";
export const NOTEBOOK_DECODER_VERSION = "1.0.0";

/** Notebook `source` is either a string or an array of lines. */
function sourceToText(source: unknown): string {
  if (typeof source === "string") return source;
  if (Array.isArray(source)) {
    return source.filter((line): line is string => typeof line === "string").join("");
  }
  return "";
}

/** Metadata worth carrying: names the notebook declares, never anything executable. */
function safeMetadata(metadata: unknown): Record<string, string> {
  if (metadata === null || typeof metadata !== "object") return {};
  const record = metadata as Record<string, unknown>;
  const out: Record<string, string> = {};
  const title = record.title;
  if (typeof title === "string") out.title = title;
  const kernelspec = record.kernelspec;
  if (kernelspec !== null && typeof kernelspec === "object") {
    const name = (kernelspec as Record<string, unknown>).display_name;
    if (typeof name === "string") out.kernel = name;
  }
  const language = record.language_info;
  if (language !== null && typeof language === "object") {
    const name = (language as Record<string, unknown>).name;
    if (typeof name === "string") out.language = name;
  }
  return out;
}

export const notebookDecoder: DocumentDecoder = {
  id: NOTEBOOK_DECODER_ID,
  version: NOTEBOOK_DECODER_VERSION,
  format: "ipynb",
  extensions: [".ipynb"],
  decode(input: DecodeInput): DecodeOutcome {
    const read = readUtf8(input);
    if ("reason" in read) {
      return {
        decoded: false,
        reason: "decoder.malformed",
        message: read.reason,
        diagnostics: [{ code: "decoder.malformed", severity: "warning", message: read.reason }],
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(read.text);
    } catch (error) {
      const message = `notebook is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
      return {
        decoded: false,
        reason: "decoder.malformed",
        message,
        diagnostics: [{ code: "decoder.malformed", severity: "warning", message }],
      };
    }
    if (parsed === null || typeof parsed !== "object") {
      const message = "notebook JSON is not an object";
      return {
        decoded: false,
        reason: "decoder.malformed",
        message,
        diagnostics: [{ code: "decoder.malformed", severity: "warning", message }],
      };
    }
    const notebook = parsed as Record<string, unknown>;
    const cells = notebook.cells;
    if (!Array.isArray(cells)) {
      const message = "notebook has no 'cells' array";
      return {
        decoded: false,
        reason: "decoder.malformed",
        message,
        diagnostics: [{ code: "decoder.malformed", severity: "warning", message }],
      };
    }

    const documentId = normalizedDocumentId({
      contentHash: input.contentHash,
      decoderId: NOTEBOOK_DECODER_ID,
      decoderVersion: NOTEBOOK_DECODER_VERSION,
    });
    const builder = new BlockBuilder(documentId, input.budget);
    let sawTitle = false;

    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      const cell = cells[cellIndex];
      if (cell === null || typeof cell !== "object") continue;
      const record = cell as Record<string, unknown>;
      const cellType = typeof record.cell_type === "string" ? record.cell_type : "unknown";
      const text = sourceToText(record.source);
      if (text.trim().length === 0) continue;

      const lines = text.split(/\r?\n/);
      const locate = (start: number, end: number) => ({
        kind: "notebook_cell" as const,
        cell_index: cellIndex,
        cell_type: cellType,
        line_start: start,
        line_end: end,
      });

      if (cellType === "code") {
        // Source only. Outputs can carry rendered HTML and image payloads, and
        // neither is something this package reads or renders.
        builder.add("code", text, locate(1, lines.length));
        continue;
      }

      // Markdown and raw cells carry the prose a notebook is actually about, so
      // they get the same heading/list structure a Markdown file gets.
      let paragraph: string[] = [];
      let paragraphStart = 1;
      const flush = (endLine: number): void => {
        if (paragraph.length === 0) return;
        builder.add("paragraph", paragraph.join("\n"), locate(paragraphStart, endLine));
        paragraph = [];
      };
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex] as string;
        const lineNumber = lineIndex + 1;
        const atx = /^(#{1,6})\s+(.*\S)\s*#*\s*$/.exec(line);
        if (atx !== null) {
          flush(lineNumber - 1);
          const level = (atx[1] as string).length;
          const kind = level === 1 && !sawTitle ? "title" : "heading";
          if (kind === "title") sawTitle = true;
          builder.add(kind, atx[2] as string, locate(lineNumber, lineNumber));
          continue;
        }
        const listItem = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/.exec(line);
        if (listItem !== null) {
          flush(lineNumber - 1);
          builder.add("list_item", listItem[1] as string, locate(lineNumber, lineNumber));
          continue;
        }
        if (line.trim().length === 0) {
          flush(lineNumber - 1);
          continue;
        }
        if (paragraph.length === 0) paragraphStart = lineNumber;
        paragraph.push(line);
      }
      flush(lines.length);
      if (builder.isFull) break;
    }

    const hasOutputs = cells.some(
      (cell) =>
        cell !== null
        && typeof cell === "object"
        && Array.isArray((cell as Record<string, unknown>).outputs)
        && ((cell as Record<string, unknown>).outputs as unknown[]).length > 0,
    );
    if (hasOutputs) {
      builder.note({
        code: "decoder.unsupported_feature",
        severity: "info",
        message: "cell outputs are present and were not read: only cell source is decoded, and no cell was executed",
      });
    }

    return {
      decoded: true,
      document: buildNormalizedDocument({
        decoder: { id: NOTEBOOK_DECODER_ID, version: NOTEBOOK_DECODER_VERSION, format: "ipynb" },
        decodeInput: input,
        documentId,
        metadata: safeMetadata(notebook.metadata),
        builder,
      }),
    };
  },
};
