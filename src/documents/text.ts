// text.ts — the formats that are already text, and the two that nearly are.
//
// Markdown, plain text, and the structured-config family decode by being read.
// What this file adds is structure: a Markdown heading becomes a `heading` block
// citing its line span, so the same work-signal extractors that read a heading in
// a Word document read one here, and a consumer never has to know which format a
// block came from in order to use it.
import * as fs from "node:fs";
import {
  BlockBuilder,
  DecodeInput,
  DecodeOutcome,
  DocumentDecoder,
  buildNormalizedDocument,
  normalizedDocumentId,
} from "./decoder";

export const TEXT_DECODER_ID = "l9.text-decoder";
export const TEXT_DECODER_VERSION = "1.0.0";
export const CSV_DECODER_ID = "l9.csv-decoder";
/**
 * 1.1.0 emits a block per populated cell beside the row block.
 *
 * The `csv_row` locator has carried an optional `column` since it was defined and
 * nothing ever set it, because the decoder's smallest unit was the row. A row
 * block's text is a rendering of the whole row — `owner: mel; status: blocked` —
 * and a reader looking for a declaration finds `owner` and stops. So a register
 * with a status column was decoded, counted, and understood to say nothing,
 * while the identical table in a worksheet was understood, purely because the
 * worksheet decoder emits cells and this one did not.
 */
export const CSV_DECODER_VERSION = "1.1.0";

/** Read a file as UTF-8, refusing bytes that are not valid UTF-8. */
export function readUtf8(input: DecodeInput): { text: string } | { reason: string } {
  if (input.sizeBytes > input.budget.maxSourceBytes) {
    return { reason: `file exceeds the ${input.budget.maxSourceBytes}-byte decoder ceiling` };
  }
  const bytes = input.bytes ?? fs.readFileSync(input.absolutePath);
  const text = bytes.toString("utf8");
  // `toString` never fails; it substitutes U+FFFD. Round-tripping is how the
  // difference between "text with a replacement character in it" and "bytes that
  // are not text" is actually established.
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    return { reason: "bytes are not valid UTF-8" };
  }
  return { text };
}

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

/** ATX and Setext headings, list items, fenced code, and everything else. */
function decodeTextBlocks(text: string, builder: BlockBuilder, markdown: boolean): void {
  const lines = text.split(/\r?\n/);
  let paragraph: string[] = [];
  let paragraphStart = 1;
  let fence: string | null = null;
  let fenceStart = 1;
  let fenceLines: string[] = [];
  let sawTitle = false;

  const flushParagraph = (endLine: number): void => {
    if (paragraph.length === 0) return;
    builder.add("paragraph", paragraph.join("\n"), {
      kind: "line_span",
      line_start: paragraphStart,
      line_end: endLine,
    });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const lineNumber = index + 1;

    if (markdown) {
      const fenceMatch = /^\s*(```|~~~)/.exec(line);
      if (fence !== null) {
        if (fenceMatch !== null && line.trim().startsWith(fence)) {
          builder.add("code", fenceLines.join("\n"), {
            kind: "line_span",
            line_start: fenceStart,
            line_end: lineNumber,
          });
          fence = null;
          fenceLines = [];
          continue;
        }
        fenceLines.push(line);
        continue;
      }
      if (fenceMatch !== null) {
        flushParagraph(lineNumber - 1);
        fence = fenceMatch[1] as string;
        fenceStart = lineNumber;
        fenceLines = [];
        continue;
      }

      const atx = /^(#{1,6})\s+(.*\S)\s*#*\s*$/.exec(line);
      if (atx !== null) {
        flushParagraph(lineNumber - 1);
        const level = (atx[1] as string).length;
        const heading = atx[2] as string;
        // The first level-1 heading is the document's title. Later ones are
        // headings: a file with three `#` sections has one title, not three.
        const kind = level === 1 && !sawTitle ? "title" : "heading";
        if (kind === "title") sawTitle = true;
        builder.add(kind, heading, { kind: "line_span", line_start: lineNumber, line_end: lineNumber });
        continue;
      }

      const listItem = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/.exec(line);
      if (listItem !== null) {
        flushParagraph(lineNumber - 1);
        builder.add("list_item", listItem[1] as string, {
          kind: "line_span",
          line_start: lineNumber,
          line_end: lineNumber,
        });
        continue;
      }
    }

    if (line.trim().length === 0) {
      flushParagraph(lineNumber - 1);
      continue;
    }
    if (paragraph.length === 0) paragraphStart = lineNumber;
    paragraph.push(line);
  }

  if (fence !== null) {
    builder.add("code", fenceLines.join("\n"), {
      kind: "line_span",
      line_start: fenceStart,
      line_end: lines.length,
    });
    builder.note({
      code: "decoder.malformed",
      severity: "info",
      message: "a fenced code block was not closed; it was read to the end of the file",
    });
  }
  flushParagraph(lines.length);
}

export const textDecoder: DocumentDecoder = {
  id: TEXT_DECODER_ID,
  version: TEXT_DECODER_VERSION,
  format: "text",
  extensions: [
    ".md", ".markdown", ".mdx", ".txt", ".rst", ".adoc", ".org",
    ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".xml",
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
    ".java", ".kt", ".kts", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".swift",
    ".php", ".pl", ".lua", ".sh", ".bash", ".zsh", ".sql", ".graphql", ".proto",
  ],
  // Build and container manifests carry no extension and are ordinary text.
  filenames: [
    "dockerfile", "containerfile", "gemfile", "jenkinsfile", "makefile", "procfile",
    "readme", "license", "changelog", "notice", "authors", "codeowners",
  ],
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
    const documentId = normalizedDocumentId({
      contentHash: input.contentHash,
      decoderId: TEXT_DECODER_ID,
      decoderVersion: TEXT_DECODER_VERSION,
    });
    const builder = new BlockBuilder(documentId, input.budget);
    const basename = input.sourcePath.slice(input.sourcePath.lastIndexOf("/") + 1).toLowerCase();
    const dot = basename.lastIndexOf(".");
    const markdown = dot > 0 && MARKDOWN_EXTENSIONS.has(basename.slice(dot));
    decodeTextBlocks(read.text, builder, markdown);
    const title = builder.finish().blocks.find((block) => block.kind === "title");
    return {
      decoded: true,
      document: buildNormalizedDocument({
        decoder: { id: TEXT_DECODER_ID, version: TEXT_DECODER_VERSION, format: markdown ? "markdown" : "text" },
        decodeInput: input,
        documentId,
        metadata: title !== undefined ? { title: title.text } : {},
        builder,
      }),
    };
  },
};

/**
 * Split one CSV line, honouring RFC 4180 quoting.
 *
 * Written out rather than split on commas because a project tracker's "Blocked
 * by: procurement, legal" cell is exactly the case a naive split corrupts, and a
 * corrupted cell becomes a corrupted work signal.
 */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] as string;
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell);
  return cells;
}

/**
 * One block per populated cell of a row, under its column's name.
 *
 * The row block stays: a row naming a blocker is worth citing as a row. These are
 * what make one *field* of it a readable statement rather than a fragment of a
 * joined string — `owner: mel; status: blocked` offers a reader `owner` and
 * nothing else, because a declaration is read up to its first colon.
 */
function addCsvCellBlocks(
  builder: BlockBuilder,
  header: readonly string[],
  cells: readonly string[],
  rowNumber: number,
): void {
  for (let column = 0; column < cells.length; column += 1) {
    const value = (cells[column] as string).trim();
    const name = (header[column] as string).trim();
    if (value.length === 0 || name.length === 0) continue;
    builder.add("cell", `${name}: ${value}`, {
      kind: "csv_row",
      row_number: rowNumber,
      column: name,
    });
    if (builder.isFull) return;
  }
}

/**
 * One block per non-empty row, plus one per populated cell, and the rows read.
 *
 * The row number is the line number in the file, so a row is citable at the place
 * an operator would look for it even though blank lines are skipped.
 */
function addCsvRowBlocks(
  builder: BlockBuilder,
  text: string,
  delimiter: string,
): string[][] {
  const rows: string[][] = [];
  let header: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line.trim().length === 0) continue;
    const cells = splitCsvLine(line, delimiter);
    if (rows.length === 0) header = cells;
    rows.push(cells);
    // Each row is a block so a row naming a blocker is citable as a row rather
    // than as "somewhere in this file".
    const labelled = header.length === cells.length && rows.length > 1;
    const label = labelled
      ? cells.map((cell, column) => `${header[column]}: ${cell}`).join("; ")
      : cells.join(" | ");
    builder.add("cell", label, { kind: "csv_row", row_number: index + 1 });
    if (!builder.isFull && labelled) addCsvCellBlocks(builder, header, cells, index + 1);
    if (builder.isFull) break;
  }
  return rows;
}

export const csvDecoder: DocumentDecoder = {
  id: CSV_DECODER_ID,
  version: CSV_DECODER_VERSION,
  format: "csv",
  extensions: [".csv", ".tsv"],
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
    const documentId = normalizedDocumentId({
      contentHash: input.contentHash,
      decoderId: CSV_DECODER_ID,
      decoderVersion: CSV_DECODER_VERSION,
    });
    const builder = new BlockBuilder(documentId, input.budget);
    const delimiter = input.sourcePath.toLowerCase().endsWith(".tsv") ? "\t" : ",";
    const rows = addCsvRowBlocks(builder, read.text, delimiter);
    if (rows.length > 0) {
      builder.addTable(rows, { kind: "csv_row", row_number: 1 });
    }
    return {
      decoded: true,
      document: buildNormalizedDocument({
        decoder: { id: CSV_DECODER_ID, version: CSV_DECODER_VERSION, format: "csv" },
        decodeInput: input,
        documentId,
        metadata: {},
        builder,
      }),
    };
  },
};
