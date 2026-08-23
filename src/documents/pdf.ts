// pdf.ts — native-text PDF, and an honest refusal for everything else.
//
// A PDF is an object graph with a cross-reference index, and its text lives in
// content streams as operators rather than as a text field. Extracting it means
// walking the xref (classic tables and xref streams both), inflating object
// streams, tokenizing content streams, and mapping byte codes through whatever
// encoding the page's fonts declare.
//
// The scope here is deliberate and bounded: **native text**. A PDF produced by a
// word processor, an exporter, or a print-to-PDF has a text layer, and this reads
// it. A scanned page has no text layer at all — it is an image — and no amount of
// parsing will find words in it.
//
// That distinction is the whole reason this file is careful. The failure mode to
// avoid is returning zero blocks for a scanned document, because "0 blocks" reads
// identically to "a document with nothing in it". A page that yields no text but
// does carry images is reported as OCR-required, which is a different fact and
// the one an operator can act on.
//
// Not supported, and said so rather than approximated: encrypted documents, and
// text whose font supplies neither a ToUnicode map nor a recognizable simple
// encoding.
import * as fs from "node:fs";
import * as zlib from "node:zlib";
import {
  BlockBuilder,
  DecodeInput,
  DecodeOutcome,
  DecoderDiagnostic,
  DocumentDecoder,
  buildNormalizedDocument,
  normalizedDocumentId,
} from "./decoder";

export const PDF_DECODER_ID = "l9.pdf-decoder";
export const PDF_DECODER_VERSION = "1.0.0";

interface PdfObject {
  offset: number;
  /** Set when the object lives inside an object stream. */
  inStream?: { streamObject: number; index: number };
}

/** A parsed PDF dictionary. Values stay as raw slices until something needs them. */
type PdfDict = Map<string, string>;

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);

function isWhitespace(byte: number): boolean {
  return WHITESPACE.has(byte);
}

function isDelimiter(byte: number): boolean {
  return [0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25].includes(byte);
}

/**
 * Split a dictionary's body into key/value text, balancing nested structures.
 *
 * A regex cannot do this: `/Font << /F1 5 0 R >>` nests, and a naive match would
 * stop at the first `>>`.
 */
export function parsePdfDict(body: string): PdfDict {
  const dict: PdfDict = new Map();
  let cursor = 0;
  while (cursor < body.length) {
    while (cursor < body.length && body[cursor] !== "/") cursor += 1;
    if (cursor >= body.length) break;
    cursor += 1;
    const nameStart = cursor;
    while (cursor < body.length && !/[\s/[\]<>()]/.test(body[cursor] as string)) cursor += 1;
    const key = body.slice(nameStart, cursor);
    while (cursor < body.length && /\s/.test(body[cursor] as string)) cursor += 1;

    const valueStart = cursor;
    let depth = 0;
    while (cursor < body.length) {
      const char = body[cursor] as string;
      if (char === "<" && body[cursor + 1] === "<") {
        depth += 1;
        cursor += 2;
        continue;
      }
      if (char === ">" && body[cursor + 1] === ">") {
        if (depth === 0) break;
        depth -= 1;
        cursor += 2;
        continue;
      }
      if (char === "[") {
        depth += 1;
        cursor += 1;
        continue;
      }
      if (char === "]") {
        depth = Math.max(0, depth - 1);
        cursor += 1;
        continue;
      }
      if (char === "/" && depth === 0 && cursor > valueStart) break;
      cursor += 1;
    }
    dict.set(key, body.slice(valueStart, cursor).trim());
  }
  return dict;
}

/** The dictionary text of an object body, or null when it has none. */
function dictBody(source: string): string | null {
  const open = source.indexOf("<<");
  if (open < 0) return null;
  let depth = 0;
  for (let cursor = open; cursor < source.length - 1; cursor += 1) {
    if (source[cursor] === "<" && source[cursor + 1] === "<") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (source[cursor] === ">" && source[cursor + 1] === ">") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 2, cursor);
      cursor += 1;
    }
  }
  return null;
}

/**
 * Every `N M obj` in the file, found by scanning.
 *
 * Scanning rather than trusting the xref table is deliberate: real archives are
 * full of PDFs with damaged or incrementally-updated cross-reference sections,
 * and a reader that insists on a valid xref refuses documents a person can open.
 * Later definitions win, which is what an incremental update means.
 */
function scanObjects(bytes: Buffer): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const text = bytes.toString("latin1");
  const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match = pattern.exec(text);
  while (match !== null) {
    objects.set(Number.parseInt(match[1] as string, 10), { offset: match.index });
    match = pattern.exec(text);
  }
  return objects;
}

/** The raw body of one object, from `obj` to its matching `endobj`. */
function objectBody(bytes: Buffer, object: PdfObject): string {
  const text = bytes.toString("latin1", object.offset, Math.min(bytes.length, object.offset + 4 * 1024 * 1024));
  const start = text.indexOf("obj");
  if (start < 0) return "";
  const end = text.indexOf("endobj", start);
  return text.slice(start + 3, end < 0 ? text.length : end);
}

/** Inflate a stream, tolerating the trailing-garbage real PDFs often carry. */
function inflate(raw: Buffer): Buffer | null {
  for (const attempt of [
    () => zlib.inflateSync(raw),
    () => zlib.inflateRawSync(raw),
    () => zlib.inflateSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }),
  ]) {
    try {
      return attempt();
    } catch {
      // Try the next strategy; a stream that resists all of them is reported.
    }
  }
  return null;
}

/** The bytes of an object's stream, decoded when the filter is one we support. */
function streamBytes(bytes: Buffer, object: PdfObject, dict: PdfDict): Buffer | null {
  const text = bytes.toString("latin1", object.offset, Math.min(bytes.length, object.offset + 4 * 1024 * 1024));
  const marker = text.indexOf("stream");
  if (marker < 0) return null;
  let start = object.offset + marker + "stream".length;
  if (bytes[start] === 0x0d) start += 1;
  if (bytes[start] === 0x0a) start += 1;

  const declared = Number.parseInt(dict.get("Length") ?? "", 10);
  let end: number;
  if (Number.isFinite(declared) && declared > 0 && start + declared <= bytes.length) {
    end = start + declared;
  } else {
    const endMarker = bytes.indexOf("endstream", start, "latin1");
    end = endMarker < 0 ? bytes.length : endMarker;
  }
  const raw = bytes.subarray(start, end);
  const filter = dict.get("Filter") ?? "";
  if (filter.includes("FlateDecode")) return inflate(raw);
  if (filter.length === 0) return raw;
  // DCTDecode, JPXDecode and friends are images; CCITTFaxDecode is a fax scan.
  // None of them holds text, and pretending otherwise would fabricate content.
  return null;
}

/** A PDF literal string, with its escape rules. */
function decodeLiteral(source: string): string {
  let out = "";
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const char = source[cursor] as string;
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = source[cursor + 1];
    if (next === undefined) break;
    cursor += 1;
    switch (next) {
      case "n": out += "\n"; break;
      case "r": out += "\r"; break;
      case "t": out += "\t"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "(": out += "("; break;
      case ")": out += ")"; break;
      case "\\": out += "\\"; break;
      case "\n": break;
      case "\r": if (source[cursor + 1] === "\n") cursor += 1; break;
      default: {
        if (next >= "0" && next <= "7") {
          let octal = next;
          while (octal.length < 3) {
            const digit = source[cursor + 1];
            if (digit === undefined || digit < "0" || digit > "7") break;
            octal += digit;
            cursor += 1;
          }
          out += String.fromCharCode(Number.parseInt(octal, 8));
        } else {
          out += next;
        }
      }
    }
  }
  return out;
}

/**
 * A font's ToUnicode CMap: the byte codes it uses and what they mean.
 *
 * Without one, a composite font's codes are indices into a glyph table and mean
 * nothing outside the file. This is what makes text from a modern PDF readable
 * rather than mojibake.
 */
function parseToUnicode(cmap: string): Map<number, string> {
  const mapping = new Map<number, string>();
  const hexToText = (hex: string): string => {
    let out = "";
    for (let index = 0; index + 3 < hex.length + 1; index += 4) {
      const unit = Number.parseInt(hex.slice(index, index + 4), 16);
      if (Number.isFinite(unit)) out += String.fromCharCode(unit);
    }
    return out;
  };

  const charPattern = /beginbfchar([\s\S]*?)endbfchar/g;
  let block = charPattern.exec(cmap);
  while (block !== null) {
    const pairs = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let pair = pairs.exec(block[1] as string);
    while (pair !== null) {
      mapping.set(Number.parseInt(pair[1] as string, 16), hexToText(pair[2] as string));
      pair = pairs.exec(block[1] as string);
    }
    block = charPattern.exec(cmap);
  }

  const rangePattern = /beginbfrange([\s\S]*?)endbfrange/g;
  let range = rangePattern.exec(cmap);
  while (range !== null) {
    const rows = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let row = rows.exec(range[1] as string);
    while (row !== null) {
      const low = Number.parseInt(row[1] as string, 16);
      const high = Number.parseInt(row[2] as string, 16);
      const base = Number.parseInt(row[3] as string, 16);
      if (Number.isFinite(low) && Number.isFinite(high) && high - low < 65_536) {
        for (let code = low; code <= high; code += 1) {
          mapping.set(code, String.fromCharCode(base + (code - low)));
        }
      }
      row = rows.exec(range[1] as string);
    }
    range = rangePattern.exec(cmap);
  }
  return mapping;
}

/** Text-showing operators, turned into the strings they show. */
function extractContentText(content: string, toUnicode: Map<number, string> | null): string[] {
  const lines: string[] = [];
  let line: string[] = [];
  let cursor = 0;

  const decodeHex = (hex: string): string => {
    const clean = hex.replace(/[^0-9A-Fa-f]/g, "");
    let out = "";
    if (toUnicode !== null) {
      for (let index = 0; index + 1 < clean.length; index += 4) {
        const code = Number.parseInt(clean.slice(index, index + 4), 16);
        out += toUnicode.get(code) ?? "";
      }
      if (out.length > 0) return out;
    }
    for (let index = 0; index + 1 < clean.length; index += 2) {
      out += String.fromCharCode(Number.parseInt(clean.slice(index, index + 2), 16));
    }
    return out;
  };

  const decodeShown = (raw: string, hex: boolean): string => {
    if (hex) return decodeHex(raw);
    const literal = decodeLiteral(raw);
    if (toUnicode === null) return literal;
    // A simple font with a ToUnicode map still addresses single bytes.
    let out = "";
    for (const char of literal) out += toUnicode.get(char.charCodeAt(0)) ?? char;
    return out;
  };

  while (cursor < content.length) {
    const char = content[cursor] as string;
    if (char === "(") {
      let depth = 1;
      let index = cursor + 1;
      let raw = "";
      while (index < content.length && depth > 0) {
        const inner = content[index] as string;
        if (inner === "\\") {
          raw += inner + (content[index + 1] ?? "");
          index += 2;
          continue;
        }
        if (inner === "(") depth += 1;
        if (inner === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
        raw += inner;
        index += 1;
      }
      line.push(decodeShown(raw, false));
      cursor = index + 1;
      continue;
    }
    if (char === "<" && content[cursor + 1] !== "<") {
      const end = content.indexOf(">", cursor);
      if (end < 0) break;
      line.push(decodeShown(content.slice(cursor + 1, end), true));
      cursor = end + 1;
      continue;
    }
    // `Td`, `TD`, `T*` and `'` all move to a new line; `ET` ends a text object.
    if (/^(T\*|TD|Td|ET|')/.test(content.slice(cursor))) {
      const joined = line.join("").trim();
      if (joined.length > 0) lines.push(joined);
      line = [];
      cursor += 2;
      continue;
    }
    cursor += 1;
  }
  const trailing = line.join("").trim();
  if (trailing.length > 0) lines.push(trailing);
  return lines;
}

/** Whether an object body declares an image XObject. */
function isImageObject(body: string): boolean {
  return /\/Subtype\s*\/Image/.test(body);
}

export const pdfDecoder: DocumentDecoder = {
  id: PDF_DECODER_ID,
  version: PDF_DECODER_VERSION,
  format: "pdf",
  extensions: [".pdf"],
  decode(input: DecodeInput): DecodeOutcome {
    if (input.sizeBytes > input.budget.maxSourceBytes) {
      const message = `file exceeds the ${input.budget.maxSourceBytes}-byte decoder ceiling`;
      return {
        decoded: false,
        reason: "decoder.budget_exceeded",
        message,
        diagnostics: [{ code: "decoder.budget_exceeded", severity: "warning", message }],
      };
    }

    const bytes = input.bytes ?? fs.readFileSync(input.absolutePath);
    if (!bytes.subarray(0, 1024).toString("latin1").includes("%PDF-")) {
      const message = "file does not begin with a PDF header";
      return {
        decoded: false,
        reason: "decoder.malformed",
        message,
        diagnostics: [{ code: "decoder.malformed", severity: "warning", message }],
      };
    }

    const head = bytes.toString("latin1");
    // `/Encrypt` in a trailer means every string and stream is enciphered. There
    // is no partial reading of an encrypted PDF, and guessing is not a thing this
    // package does.
    if (/trailer[\s\S]{0,2048}?\/Encrypt\b/.test(head) || /\/Encrypt\s+\d+\s+\d+\s+R/.test(head)) {
      const message = "document is encrypted; its text cannot be read without a credential";
      return {
        decoded: false,
        reason: "decoder.encrypted",
        message,
        diagnostics: [{ code: "decoder.encrypted", severity: "warning", message }],
      };
    }

    const objects = scanObjects(bytes);
    if (objects.size === 0) {
      const message = "no PDF objects were found; the file may be truncated";
      return {
        decoded: false,
        reason: "decoder.malformed",
        message,
        diagnostics: [{ code: "decoder.malformed", severity: "warning", message }],
      };
    }

    const documentId = normalizedDocumentId({
      contentHash: input.contentHash,
      decoderId: PDF_DECODER_ID,
      decoderVersion: PDF_DECODER_VERSION,
    });
    const builder = new BlockBuilder(documentId, input.budget);
    const diagnostics: DecoderDiagnostic[] = [];

    // One ToUnicode map for the document. Per-font resolution would be more
    // precise; a single merged map is enough to read the overwhelming majority of
    // exported documents and never invents a character it has no mapping for.
    let toUnicode: Map<number, string> | null = null;
    for (const [, object] of objects) {
      const body = objectBody(bytes, object);
      if (!body.includes("/ToUnicode") && !body.includes("beginbfchar") && !body.includes("beginbfrange")) continue;
      const dict = parsePdfDict(dictBody(body) ?? "");
      const stream = streamBytes(bytes, object, dict);
      if (stream === null) continue;
      const text = stream.toString("latin1");
      if (!text.includes("beginbfchar") && !text.includes("beginbfrange")) continue;
      const parsed = parseToUnicode(text);
      if (parsed.size === 0) continue;
      if (toUnicode === null) toUnicode = parsed;
      else for (const [code, value] of parsed) if (!toUnicode.has(code)) toUnicode.set(code, value);
    }

    // Pages in file order. A PDF's page tree can be reordered, but content-stream
    // order is what a linear read gives and is stable for the same bytes.
    const pageObjects = [...objects.entries()]
      .filter(([, object]) => /\/Type\s*\/Page\b/.test(objectBody(bytes, object)))
      .sort((a, b) => a[1].offset - b[1].offset);

    let pagesWithText = 0;
    let pagesWithoutText = 0;
    let imageObjects = 0;
    for (const [, object] of objects) {
      if (isImageObject(objectBody(bytes, object))) imageObjects += 1;
    }

    const readContent = (reference: string): string[] => {
      const texts: string[] = [];
      const references = [...reference.matchAll(/(\d+)\s+\d+\s+R/g)].map((match) =>
        Number.parseInt(match[1] as string, 10));
      for (const number of references) {
        const target = objects.get(number);
        if (target === undefined) continue;
        const body = objectBody(bytes, target);
        const dict = parsePdfDict(dictBody(body) ?? "");
        const stream = streamBytes(bytes, target, dict);
        if (stream === null) continue;
        texts.push(...extractContentText(stream.toString("latin1"), toUnicode));
      }
      return texts;
    };

    for (let index = 0; index < pageObjects.length; index += 1) {
      if (builder.isFull) break;
      const entry = pageObjects[index];
      if (entry === undefined) continue;
      const body = objectBody(bytes, entry[1]);
      const dict = parsePdfDict(dictBody(body) ?? "");
      const contents = dict.get("Contents") ?? "";
      const lines = readContent(contents);
      if (lines.length === 0) {
        pagesWithoutText += 1;
        continue;
      }
      pagesWithText += 1;
      for (let blockIndex = 0; blockIndex < lines.length; blockIndex += 1) {
        const text = lines[blockIndex] as string;
        // The first line of the first page is the closest thing a PDF has to a
        // declared title when its metadata carries none.
        const kind = index === 0 && blockIndex === 0 ? "title" : "paragraph";
        builder.add(kind, text, {
          kind: "pdf_page_block",
          page_number: index + 1,
          block_index: blockIndex + 1,
        });
        if (builder.isFull) break;
      }
    }

    // The honest outcome for a scan: no text layer, images present, say so.
    if (pagesWithText === 0) {
      const message = imageObjects > 0
        ? `no text layer was found across ${pageObjects.length || 1} page(s); `
          + `${imageObjects} image object(s) are present, so this is a scanned document requiring OCR`
        : "no text layer was found and no image objects are present; the document yielded nothing readable";
      return {
        decoded: false,
        reason: imageObjects > 0 ? "decoder.ocr_required" : "decoder.unsupported_feature",
        message,
        diagnostics: [
          { code: imageObjects > 0 ? "decoder.ocr_required" : "decoder.unsupported_feature", severity: "warning", message },
        ],
      };
    }
    if (pagesWithoutText > 0) {
      diagnostics.push({
        code: "decoder.ocr_required",
        severity: "info",
        message:
          `${pagesWithoutText} of ${pageObjects.length} page(s) carried no text layer and would need OCR; `
          + `${pagesWithText} page(s) were read`,
      });
    }
    if (toUnicode === null) {
      diagnostics.push({
        code: "decoder.unsupported_feature",
        severity: "info",
        message: "no ToUnicode map was found; text was read through the font's built-in byte encoding",
      });
    }
    for (const diagnostic of diagnostics) builder.note(diagnostic);

    const titleMatch = /\/Title\s*\(([^)]*)\)/.exec(head);
    return {
      decoded: true,
      document: buildNormalizedDocument({
        decoder: { id: PDF_DECODER_ID, version: PDF_DECODER_VERSION, format: "pdf" },
        decodeInput: input,
        documentId,
        metadata: titleMatch !== null ? { title: decodeLiteral(titleMatch[1] as string) } : {},
        builder,
      }),
    };
  },
};

/** Exported for the decoder tests, which exercise the tokenizer directly. */
export const pdfInternals = { parsePdfDict, extractContentText, parseToUnicode, decodeLiteral, isWhitespace, isDelimiter };
