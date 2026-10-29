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
  BlockLocator,
  DecodeInput,
  DecodeOutcome,
  DocumentDecoder,
  buildNormalizedDocument,
  normalizedDocumentId,
} from "./decoder";

export const TEXT_DECODER_ID = "l9.text-decoder";
// 1.1.0: a leading byte-order mark is not part of line 1, and an ATX closing
// sequence (`## Status ##`) is not part of the heading text.
// 1.2.0: the Markdown dialect is declared (`dialectFor`) and enters the
// normalized document id and cache key (ADR-059), so a `.md` and a `.txt` with
// identical bytes are two documents and an entry keyed without it is never served.
// 1.3.0: a lone CR ends a line, as CRLF and LF do, so line numbers match the
// extractors' `toLines`.
export const TEXT_DECODER_VERSION = "1.3.0";
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
// 1.2.0: a record ends at a newline outside quotes, so a quoted cell that
// spans lines stays one cell and its row cites the line the record starts on.
// 1.3.0: the tab-separated dialect is declared (`dialectFor`) and enters the
// normalized document id and cache key (ADR-059), so a `.csv` and a `.tsv` with
// identical bytes are two documents and an entry keyed without it is never served.
// 1.4.0: a `"` opens a quoted field only as the field's first character
// (RFC 4180); one inside an unquoted field (`27"`) is literal and no longer
// joins the following lines into its record.
export const CSV_DECODER_VERSION = "1.4.0";

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
  // A byte-order mark announces the encoding; it is not the first character of
  // line 1. Left in, it stops `# Title` being a heading and a notebook being
  // JSON. Stripped only after validity is established on the original bytes.
  return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text };
}

/** Exactly the characters JavaScript's `\s` matches. */
function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

/** Characters `.` does not match; content containing one never matched the old expressions. */
function isLineTerminator(char: string): boolean {
  return char === "\n" || char === "\r" || char === "\u2028" || char === "\u2029";
}

/**
 * The content of `line` between `from` and its last non-whitespace character,
 * or null when there is none or it holds a line terminator. One pass.
 */
function trimmedContent(line: string, from: number): string | null {
  let start = from;
  while (start < line.length && isSpace(line[start])) start += 1;
  let end = line.length;
  while (end > start && isSpace(line[end - 1])) end -= 1;
  if (end <= start) return null;
  for (let index = start; index < end; index += 1) {
    if (isLineTerminator(line[index] as string)) return null;
  }
  return line.slice(start, end);
}

/**
 * An ATX heading: one to six `#`, whitespace, then content.
 *
 * A linear scan rather than `/^(#{1,6})\s+(.*\S)\s*#*\s*$/`, whose `\s+` and
 * `.*` overlap and try every split of a long whitespace run before failing. A
 * closing sequence — whitespace then only `#` to the end of the line — is not
 * part of the text; a `#` with no whitespace before it (`C#`) is.
 */
function classifyAtxHeading(line: string): { level: number; text: string } | null {
  let level = 0;
  while (level < line.length && line[level] === "#") level += 1;
  if (level < 1 || level > 6 || !isSpace(line[level])) return null;
  const content = trimmedContent(line, level);
  if (content === null) return null;
  let hashes = content.length;
  while (hashes > 0 && content[hashes - 1] === "#") hashes -= 1;
  if (hashes < content.length && hashes > 0 && isSpace(content[hashes - 1])) {
    let end = hashes - 1;
    while (end > 0 && isSpace(content[end - 1])) end -= 1;
    if (end > 0) return { level, text: content.slice(0, end) };
  }
  return { level, text: content };
}

/**
 * A list item: optional indentation, `-`, `*`, `+` or digits with `.`/`)`,
 * whitespace, then content. The linear form of
 * `/^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/`.
 */
function classifyListItem(line: string): string | null {
  let index = 0;
  while (index < line.length && isSpace(line[index])) index += 1;
  const marker = line[index];
  if (marker === "-" || marker === "*" || marker === "+") {
    index += 1;
  } else {
    const digits = index;
    while (index < line.length && (line[index] as string) >= "0" && (line[index] as string) <= "9") index += 1;
    if (index === digits || (line[index] !== "." && line[index] !== ")")) return null;
    index += 1;
  }
  if (!isSpace(line[index])) return null;
  return trimmedContent(line, index);
}

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

/** Lowercased extension of a source path's last segment, with its dot, or "". */
function extensionOfSourcePath(sourcePath: string): string {
  const basename = sourcePath.slice(sourcePath.lastIndexOf("/") + 1).toLowerCase();
  const dot = basename.lastIndexOf(".");
  return dot > 0 ? basename.slice(dot) : "";
}

/**
 * The text decoder's dialect for a path: `markdown`, or none for plain text.
 *
 * The one place the text decoder looks at a name. The decoder branches on it
 * and the corpus keys on it, so the two cannot disagree about which document
 * a set of bytes became.
 */
function textDialectFor(sourcePath: string): string | undefined {
  return MARKDOWN_EXTENSIONS.has(extensionOfSourcePath(sourcePath)) ? "markdown" : undefined;
}

/** The CSV decoder's dialect for a path: `tsv`, or none for comma-separated. */
function csvDialectFor(sourcePath: string): string | undefined {
  return extensionOfSourcePath(sourcePath) === ".tsv" ? "tsv" : undefined;
}

/** How a caller places a block read from a span of lines, and what it calls the span. */
export interface TextBlockScope {
  /** The locator for lines `start`..`end` (1-based, inclusive) of this text. */
  locate: (start: number, end: number) => BlockLocator;
  /** Shared across calls when several texts form one document, as a notebook's cells do. */
  title: { seen: boolean };
  /** What the text is, for diagnostics: "file" or "cell". */
  unit: string;
}

function lineSpanScope(): TextBlockScope {
  return {
    locate: (start, end) => ({ kind: "line_span", line_start: start, line_end: end }),
    title: { seen: false },
    unit: "file",
  };
}

/**
 * ATX headings, list items, fenced code, and everything else.
 *
 * Markdown files and a notebook's Markdown cells both come through here, so a
 * fence means code in either and a heading means a heading in either.
 */
export function decodeTextBlocks(
  text: string,
  builder: BlockBuilder,
  markdown: boolean,
  scope: TextBlockScope = lineSpanScope(),
): void {
  // CRLF, LF and a lone CR each end one line — the terminators the extractors'
  // `toLines` honours — so a classic-Mac or mixed-ending file is cited at the
  // line numbers an editor shows, and a decoded block and an extracted
  // assertion on the same line agree on its number.
  const lines = text.split(/\r\n|\r|\n/);
  let paragraph: string[] = [];
  let paragraphStart = 1;
  let fence: string | null = null;
  let fenceStart = 1;
  let fenceLines: string[] = [];

  const flushParagraph = (endLine: number): void => {
    if (paragraph.length === 0) return;
    builder.add("paragraph", paragraph.join("\n"), scope.locate(paragraphStart, endLine));
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const lineNumber = index + 1;

    if (markdown) {
      const fenceMatch = /^\s*(```|~~~)/.exec(line);
      if (fence !== null) {
        if (fenceMatch !== null && line.trim().startsWith(fence)) {
          builder.add("code", fenceLines.join("\n"), scope.locate(fenceStart, lineNumber));
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

      const atx = classifyAtxHeading(line);
      if (atx !== null) {
        flushParagraph(lineNumber - 1);
        // The first level-1 heading is the document's title. Later ones are
        // headings: a file with three `#` sections has one title, not three.
        const kind = atx.level === 1 && !scope.title.seen ? "title" : "heading";
        if (kind === "title") scope.title.seen = true;
        builder.add(kind, atx.text, scope.locate(lineNumber, lineNumber));
        continue;
      }

      const listItem = classifyListItem(line);
      if (listItem !== null) {
        flushParagraph(lineNumber - 1);
        builder.add("list_item", listItem, scope.locate(lineNumber, lineNumber));
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
    builder.add("code", fenceLines.join("\n"), scope.locate(fenceStart, lines.length));
    builder.note({
      code: "decoder.malformed",
      severity: "info",
      message: `a fenced code block was not closed; it was read to the end of the ${scope.unit}`,
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
  dialectFor: textDialectFor,
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
    const dialect = textDialectFor(input.sourcePath);
    const documentId = normalizedDocumentId({
      contentHash: input.contentHash,
      decoderId: TEXT_DECODER_ID,
      decoderVersion: TEXT_DECODER_VERSION,
      ...(dialect !== undefined ? { dialect } : {}),
    });
    const builder = new BlockBuilder(documentId, input.budget);
    const markdown = dialect === "markdown";
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
 *
 * A `"` opens a quoted field only as the field's first character (RFC 4180
 * §2.5). Anywhere else in an unquoted field it is a literal character, so a
 * height written `27"` keeps its quote and does not swallow the cells after it.
 */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  let fieldStart = true;
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
    if (char === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
      continue;
    }
    if (char === delimiter) {
      cells.push(cell);
      cell = "";
      fieldStart = true;
      continue;
    }
    fieldStart = false;
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
 * The records of a delimited file, each with the physical line it starts on.
 *
 * A newline ends a record only outside quotes. Quote state follows the rule
 * `splitCsvLine` applies, so the two agree on where a quoted field ends: a `"`
 * opens a quoted field only as the field's first character, `""` inside one is
 * an escaped quote, and any other `"` inside one closes it. A `"` in the middle
 * of an unquoted field (`27"`) is a literal and never joins the next line on. A
 * quote still open at end of file leaves the rest as one record, so no content
 * is dropped, and is reported.
 */
function csvRecords(
  text: string,
  delimiter: string,
): { records: { text: string; line: number }[]; unterminatedAt: number | null } {
  const records: { text: string; line: number }[] = [];
  let start = 0;
  let startLine = 1;
  let line = 1;
  let quoted = false;
  let fieldStart = true;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\n") line += 1;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') index += 1;
        else quoted = false;
      }
      continue;
    }
    if (char === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
      continue;
    }
    if (char === delimiter) {
      fieldStart = true;
      continue;
    }
    if (char !== "\n") {
      fieldStart = false;
      continue;
    }
    const end = index > start && text[index - 1] === "\r" ? index - 1 : index;
    records.push({ text: text.slice(start, end), line: startLine });
    start = index + 1;
    startLine = line;
    fieldStart = true;
  }
  if (start < text.length) records.push({ text: text.slice(start), line: startLine });
  return { records, unterminatedAt: quoted ? startLine : null };
}

/**
 * One block per non-empty record, plus one per populated cell, and the rows read.
 *
 * The row number is the line number in the file a record starts on, so a row is
 * citable at the place an operator would look for it even though blank lines are
 * skipped and a quoted cell may span several lines.
 */
function addCsvRowBlocks(
  builder: BlockBuilder,
  text: string,
  delimiter: string,
): string[][] {
  const rows: string[][] = [];
  let header: string[] = [];
  const { records, unterminatedAt } = csvRecords(text, delimiter);
  if (unterminatedAt !== null) {
    builder.note({
      code: "decoder.malformed",
      severity: "info",
      message: `a quoted field opened in the record starting on line ${unterminatedAt} is never closed; `
        + "the rest of the file was read as that record",
    });
  }
  for (const record of records) {
    const line = record.text;
    const rowNumber = record.line;
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
    builder.add("cell", label, { kind: "csv_row", row_number: rowNumber });
    if (!builder.isFull && labelled) addCsvCellBlocks(builder, header, cells, rowNumber);
    if (builder.isFull) break;
  }
  return rows;
}

export const csvDecoder: DocumentDecoder = {
  id: CSV_DECODER_ID,
  version: CSV_DECODER_VERSION,
  format: "csv",
  extensions: [".csv", ".tsv"],
  dialectFor: csvDialectFor,
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
    const dialect = csvDialectFor(input.sourcePath);
    const documentId = normalizedDocumentId({
      contentHash: input.contentHash,
      decoderId: CSV_DECODER_ID,
      decoderVersion: CSV_DECODER_VERSION,
      ...(dialect !== undefined ? { dialect } : {}),
    });
    const builder = new BlockBuilder(documentId, input.budget);
    const delimiter = dialect === "tsv" ? "\t" : ",";
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
