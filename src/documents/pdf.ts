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
  DecoderBudget,
  DecodeOutcome,
  DecoderDiagnostic,
  DocumentDecoder,
  buildNormalizedDocument,
  normalizedDocumentId,
} from "./decoder";

export const PDF_DECODER_ID = "l9.pdf-decoder";
export const PDF_DECODER_VERSION = "1.1.0";

interface PdfObject {
  offset: number;
  /** Where this object's extent ends: the next object header in file order. */
  bound: number;
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
 *
 * Each object's extent is fixed here, once: it ends at the next header in file
 * order — superseded definitions included — so reading an object never looks
 * past where the file says the next one starts, and the cost of reading every
 * object is the size of the file rather than the size of the file per object.
 */
function scanObjects(text: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const inFileOrder: PdfObject[] = [];
  const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const object: PdfObject = { offset: match.index, bound: text.length };
    inFileOrder.push(object);
    objects.set(Number.parseInt(match[1] as string, 10), object);
    match = pattern.exec(text);
  }
  for (let index = 0; index + 1 < inFileOrder.length; index += 1) {
    (inFileOrder[index] as PdfObject).bound = (inFileOrder[index + 1] as PdfObject).offset;
  }
  return objects;
}

/** One object read once: its body, its dictionary, and where its stream starts. */
interface ObjectParts {
  /** The raw body, from `obj` to its matching `endobj` (or the end of its extent). */
  body: string;
  dict: PdfDict;
  /** Absolute offset of the first byte of the object's stream data, or -1. */
  streamStart: number;
  /** Absolute offset where the object's body ends. */
  bodyEnd: number;
}

/**
 * The decompression a single document may spend.
 *
 * `perStream` bounds any one inflation; `remaining` is what is left of the
 * document's aggregate allowance. Every inflation is charged, including one
 * refused for size, because finding out took that much work.
 */
interface InflateAllowance {
  readonly perStream: number;
  readonly total: number;
  remaining: number;
  /** Streams not inflated because the aggregate allowance ran out. */
  skipped: number;
}

/**
 * The aggregate allowance for one PDF.
 *
 * `maxPartBytes` bounds one decompressed stream, as it bounds one OOXML part.
 * `maxCompressionRatio` bounds the document as a whole: all of its decompressed
 * stream bytes together may not exceed that multiple of the file's own size, and
 * never more than four streams' worth of `maxPartBytes`.
 */
function inflateAllowance(budget: DecoderBudget, sourceBytes: number): InflateAllowance {
  const perStream = Math.max(1, budget.maxPartBytes);
  const total = Math.max(1, Math.min(budget.maxCompressionRatio * sourceBytes, 4 * perStream));
  return { perStream, total, remaining: total, skipped: 0 };
}

type InflateResult =
  | { kind: "ok"; bytes: Buffer }
  | { kind: "over_budget"; ceiling: number; aggregate: boolean }
  | { kind: "unreadable" };

/**
 * Inflate a stream, tolerating the trailing-garbage real PDFs often carry.
 *
 * zlib itself enforces the ceiling (`maxOutputLength`), so a stream cannot
 * produce more than it is allowed however it is built. A stream that hits the
 * ceiling is over budget, which is a different fact from a corrupt one: the
 * strategy loop stops there instead of trying the next way to read it.
 */
function inflate(raw: Buffer, allowance: InflateAllowance): InflateResult {
  if (allowance.remaining <= 0) {
    allowance.skipped += 1;
    return { kind: "over_budget", ceiling: allowance.total, aggregate: true };
  }
  const ceiling = Math.min(allowance.perStream, allowance.remaining);
  const aggregate = ceiling < allowance.perStream;
  for (const attempt of [
    () => zlib.inflateSync(raw, { maxOutputLength: ceiling }),
    () => zlib.inflateRawSync(raw, { maxOutputLength: ceiling }),
    () => zlib.inflateSync(raw, { maxOutputLength: ceiling, finishFlush: zlib.constants.Z_SYNC_FLUSH }),
  ]) {
    try {
      const bytes = attempt();
      allowance.remaining -= bytes.length;
      return { kind: "ok", bytes };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
        allowance.remaining -= ceiling;
        if (aggregate) {
          allowance.remaining = 0;
          allowance.skipped += 1;
        }
        return { kind: "over_budget", ceiling: aggregate ? allowance.total : ceiling, aggregate };
      }
      // Try the next strategy; a stream that resists all of them is reported.
    }
  }
  return { kind: "unreadable" };
}

/**
 * The bytes and objects of one PDF, with every object read at most once.
 *
 * A body is a slice of the file's own text, so caching every body costs no
 * copy; the passes over the document (fonts, pages, images, content) reuse them
 * rather than re-reading a window of the file per object per pass.
 */
class PdfFile {
  private readonly parts = new Map<PdfObject, ObjectParts>();
  /** Streams that did not decode, kept so a refused stream is not tried twice. */
  private readonly failedStreams = new Map<PdfObject, InflateResult>();
  readonly budgetNotes: DecoderDiagnostic[] = [];

  constructor(
    readonly bytes: Buffer,
    readonly text: string,
    readonly objects: Map<number, PdfObject>,
    readonly allowance: InflateAllowance,
  ) {}

  /** The body, dictionary and stream position of an object. */
  partsOf(object: PdfObject): ObjectParts {
    const cached = this.parts.get(object);
    if (cached !== undefined) return cached;
    const extent = this.text.slice(object.offset, object.bound);
    const start = extent.indexOf("obj");
    let parts: ObjectParts;
    if (start < 0) {
      parts = { body: "", dict: new Map(), streamStart: -1, bodyEnd: object.offset };
    } else {
      const end = extent.indexOf("endobj", start);
      const body = extent.slice(start + 3, end < 0 ? extent.length : end);
      const bodyStart = object.offset + start + 3;
      const marker = body.indexOf("stream");
      let streamStart = -1;
      if (marker >= 0) {
        streamStart = bodyStart + marker + "stream".length;
        if (this.bytes[streamStart] === 0x0d) streamStart += 1;
        if (this.bytes[streamStart] === 0x0a) streamStart += 1;
      }
      parts = {
        body,
        dict: parsePdfDict(dictBody(body) ?? ""),
        streamStart,
        bodyEnd: bodyStart + body.length,
      };
    }
    this.parts.set(object, parts);
    return parts;
  }

  /** The raw body of one object, from `obj` to its matching `endobj`. */
  objectBody(object: PdfObject): string {
    return this.partsOf(object).body;
  }

  /** The bytes of an object's stream, decoded when the filter is one we support. */
  streamBytes(object: PdfObject, number: number): InflateResult {
    const failed = this.failedStreams.get(object);
    if (failed !== undefined) return failed;
    const result = this.readStream(object, number);
    if (result.kind !== "ok") this.failedStreams.set(object, result);
    return result;
  }

  private readStream(object: PdfObject, number: number): InflateResult {
    const { dict, streamStart: start, bodyEnd } = this.partsOf(object);
    if (start < 0) return { kind: "unreadable" };
    const declared = Number.parseInt(dict.get("Length") ?? "", 10);
    let end: number;
    if (Number.isFinite(declared) && declared > 0 && start + declared <= this.bytes.length) {
      end = start + declared;
    } else {
      // Without a usable /Length the stream ends at the last `endstream` inside
      // this object's own body, never at one belonging to a later object.
      const endMarker = this.text.slice(start, bodyEnd).lastIndexOf("endstream");
      end = endMarker < 0 ? bodyEnd : start + endMarker;
    }
    const raw = this.bytes.subarray(start, end);
    const filter = dict.get("Filter") ?? "";
    if (filter.includes("FlateDecode")) {
      const result = inflate(raw, this.allowance);
      if (result.kind === "over_budget" && !result.aggregate) {
        this.budgetNotes.push({
          code: "decoder.budget_exceeded",
          severity: "warning",
          message:
            `object ${number}'s stream decompresses to more than the ${result.ceiling}-byte `
            + "per-stream ceiling and was not read",
          part: `object ${number}`,
        });
      }
      return result;
    }
    if (filter.length === 0) return { kind: "ok", bytes: raw };
    // DCTDecode, JPXDecode and friends are images; CCITTFaxDecode is a fax scan.
    // None of them holds text, and pretending otherwise would fabricate content.
    return { kind: "unreadable" };
  }

  /** The aggregate-allowance diagnostic, when the allowance ran out. */
  allowanceNote(): DecoderDiagnostic | null {
    if (this.allowance.skipped === 0) return null;
    return {
      code: "decoder.budget_exceeded",
      severity: "warning",
      message:
        `the document's decompression allowance of ${this.allowance.total} bytes was exhausted; `
        + `${this.allowance.skipped} stream(s) were not inflated`,
    };
  }
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
          out += String.fromCodePoint(Number.parseInt(octal, 8));
        } else {
          out += next;
        }
      }
    }
  }
  return out;
}

/** Code-to-text lookup, as a ToUnicode map or a merge of several answers it. */
interface CodeLookup {
  get(code: number): string | undefined;
}

/** One `bfrange` row: codes `low..high` map to `dest` plus the code's offset. */
interface CodeRange {
  low: number;
  high: number;
  dest: string;
}

/** A stretch of codes answered by one range row; stretches never overlap. */
interface CodeSegment {
  low: number;
  high: number;
  row: CodeRange;
}

/** A max-heap of row indices, so the latest row covering a code wins. */
class LatestRowHeap {
  private readonly items: number[] = [];

  get top(): number | undefined {
    return this.items[0];
  }

  push(value: number): void {
    const items = this.items;
    items.push(value);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if ((items[parent] as number) >= value) break;
      items[index] = items[parent] as number;
      index = parent;
    }
    items[index] = value;
  }

  pop(): void {
    const items = this.items;
    const last = items.pop();
    if (last === undefined || items.length === 0) return;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      if (left >= items.length) break;
      const right = left + 1;
      const child = right < items.length && (items[right] as number) > (items[left] as number) ? right : left;
      if ((items[child] as number) <= last) break;
      items[index] = items[child] as number;
      index = child;
    }
    items[index] = last;
  }
}

/**
 * Flatten range rows into non-overlapping segments, later rows winning.
 *
 * That is exactly what setting each row's codes into a map in order produced,
 * without materializing one entry per code: memory stays linear in the number of
 * rows a CMap writes, however wide each row claims to be.
 */
function flattenRanges(rows: CodeRange[]): CodeSegment[] {
  if (rows.length === 0) return [];
  const starts = new Map<number, number[]>();
  const ends = new Map<number, number[]>();
  rows.forEach((row, index) => {
    const opening = starts.get(row.low);
    if (opening === undefined) starts.set(row.low, [index]);
    else opening.push(index);
    const closing = ends.get(row.high + 1);
    if (closing === undefined) ends.set(row.high + 1, [index]);
    else closing.push(index);
  });
  const points = [...new Set([...starts.keys(), ...ends.keys()])].sort((a, b) => a - b);
  const closed = new Uint8Array(rows.length);
  const open = new LatestRowHeap();
  const segments: CodeSegment[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const point = points[index] as number;
    for (const row of ends.get(point) ?? []) closed[row] = 1;
    for (const row of starts.get(point) ?? []) open.push(row);
    while (open.top !== undefined && closed[open.top] === 1) open.pop();
    if (open.top === undefined) continue;
    const row = rows[open.top] as CodeRange;
    const high = (points[index + 1] as number) - 1;
    const previous = segments[segments.length - 1];
    if (previous !== undefined && previous.row === row && previous.high + 1 === point) previous.high = high;
    else segments.push({ low: point, high, row });
  }
  return segments;
}

const utf16Units = (hex: string): number[] => {
  const units: number[] = [];
  for (let index = 0; index + 3 < hex.length + 1; index += 4) {
    const unit = Number.parseInt(hex.slice(index, index + 4), 16);
    if (Number.isFinite(unit)) units.push(unit);
  }
  return units;
};

const unitsToText = (units: number[]): string => {
  let out = "";
  for (const unit of units) {
    if (unit >= 0 && unit <= 0xffff) out += String.fromCharCode(unit);
    else if (unit >= 0 && unit <= 0x10ffff) out += String.fromCodePoint(unit);
  }
  return out;
};

const destTextForOffset = (hex: string, offset: number): string => {
  const units = utf16Units(hex);
  if (units.length === 0) return "";
  units[units.length - 1] += offset;
  return unitsToText(units);
};

/**
 * A parsed ToUnicode CMap.
 *
 * `bfchar` rows are kept as entries and `bfrange` rows as ranges looked up on
 * demand. A range row overrides a `bfchar` row for the same code, and a later
 * range row overrides an earlier one, as they always have.
 */
class ToUnicodeMap implements CodeLookup {
  private readonly segments: CodeSegment[];

  constructor(
    private readonly chars: Map<number, string>,
    ranges: CodeRange[],
  ) {
    this.segments = flattenRanges(ranges);
  }

  /** Number of rows that map something; zero means the CMap mapped nothing. */
  get size(): number {
    return this.chars.size + this.segments.length;
  }

  get(code: number): string | undefined {
    let low = 0;
    let high = this.segments.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const segment = this.segments[middle] as CodeSegment;
      if (code < segment.low) high = middle - 1;
      else if (code > segment.high) low = middle + 1;
      else return destTextForOffset(segment.row.dest, code - segment.row.low);
    }
    return this.chars.get(code);
  }
}

/** Several maps answered in order, the first that knows a code winning. */
class MergedLookup implements CodeLookup {
  constructor(private readonly maps: ToUnicodeMap[]) {}

  get(code: number): string | undefined {
    for (const map of this.maps) {
      const value = map.get(code);
      if (value !== undefined) return value;
    }
    return undefined;
  }
}

/**
 * A font's ToUnicode CMap: the byte codes it uses and what they mean.
 *
 * Without one, a composite font's codes are indices into a glyph table and mean
 * nothing outside the file. This is what makes text from a modern PDF readable
 * rather than mojibake.
 */
function parseToUnicode(cmap: string): ToUnicodeMap {
  const chars = new Map<number, string>();
  const charPattern = /beginbfchar([\s\S]*?)endbfchar/g;
  let block = charPattern.exec(cmap);
  while (block !== null) {
    const pairs = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let pair = pairs.exec(block[1] as string);
    while (pair !== null) {
      chars.set(Number.parseInt(pair[1] as string, 16), unitsToText(utf16Units(pair[2] as string)));
      pair = pairs.exec(block[1] as string);
    }
    block = charPattern.exec(cmap);
  }

  const ranges: CodeRange[] = [];
  const rangePattern = /beginbfrange([\s\S]*?)endbfrange/g;
  let range = rangePattern.exec(cmap);
  while (range !== null) {
    const rows = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let row = rows.exec(range[1] as string);
    while (row !== null) {
      const low = Number.parseInt(row[1] as string, 16);
      const high = Number.parseInt(row[2] as string, 16);
      if (Number.isFinite(low) && Number.isFinite(high) && high >= low && high - low < 65_536) {
        ranges.push({ low, high, dest: row[3] as string });
      }
      row = rows.exec(range[1] as string);
    }
    range = rangePattern.exec(cmap);
  }
  return new ToUnicodeMap(chars, ranges);
}

/** Text-showing operators, turned into the strings they show. */
function extractContentText(content: string, toUnicode: CodeLookup | null): string[] {
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
      out += String.fromCodePoint(Number.parseInt(clean.slice(index, index + 2), 16));
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

    const objects = scanObjects(head);
    if (objects.size === 0) {
      const message = "no PDF objects were found; the file may be truncated";
      return {
        decoded: false,
        reason: "decoder.malformed",
        message,
        diagnostics: [{ code: "decoder.malformed", severity: "warning", message }],
      };
    }
    const file = new PdfFile(bytes, head, objects, inflateAllowance(input.budget, bytes.length));

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
    const cmaps: ToUnicodeMap[] = [];
    for (const [number, object] of objects) {
      const body = file.objectBody(object);
      if (!body.includes("/ToUnicode") && !body.includes("beginbfchar") && !body.includes("beginbfrange")) continue;
      const stream = file.streamBytes(object, number);
      if (stream.kind !== "ok") continue;
      const text = stream.bytes.toString("latin1");
      if (!text.includes("beginbfchar") && !text.includes("beginbfrange")) continue;
      const parsed = parseToUnicode(text);
      if (parsed.size === 0) continue;
      cmaps.push(parsed);
    }
    const toUnicode: CodeLookup | null = cmaps.length === 0 ? null : new MergedLookup(cmaps);

    // Pages in file order. A PDF's page tree can be reordered, but content-stream
    // order is what a linear read gives and is stable for the same bytes.
    const pageObjects = [...objects.entries()]
      .filter(([, object]) => /\/Type\s*\/Page\b/.test(file.objectBody(object)))
      .sort((a, b) => a[1].offset - b[1].offset);

    let pagesWithText = 0;
    let pagesWithoutText = 0;
    let pagesOverBudget = 0;
    let imageObjects = 0;
    for (const [, object] of objects) {
      if (isImageObject(file.objectBody(object))) imageObjects += 1;
    }

    const readContent = (reference: string): { lines: string[]; overBudget: boolean } => {
      const texts: string[] = [];
      let overBudget = false;
      const references = [...reference.matchAll(/(\d+)\s+\d+\s+R/g)].map((match) =>
        Number.parseInt(match[1] as string, 10));
      for (const number of references) {
        const target = objects.get(number);
        if (target === undefined) continue;
        const stream = file.streamBytes(target, number);
        if (stream.kind === "over_budget") overBudget = true;
        if (stream.kind !== "ok") continue;
        texts.push(...extractContentText(stream.bytes.toString("latin1"), toUnicode));
      }
      return { lines: texts, overBudget };
    };

    for (let index = 0; index < pageObjects.length; index += 1) {
      if (builder.isFull) break;
      const entry = pageObjects[index];
      if (entry === undefined) continue;
      const contents = file.partsOf(entry[1]).dict.get("Contents") ?? "";
      const { lines, overBudget } = readContent(contents);
      if (lines.length === 0) {
        // A page whose content was refused for size is not a page without text;
        // calling it a scan would send an operator to OCR a document that has none.
        if (overBudget) pagesOverBudget += 1;
        else pagesWithoutText += 1;
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

    const budgetNotes = [...file.budgetNotes];
    const allowanceNote = file.allowanceNote();
    if (allowanceNote !== null) budgetNotes.push(allowanceNote);

    // Nothing was read because what there was to read exceeded the budget: that
    // is the reason, not a scan and not an unsupported feature.
    if (pagesWithText === 0 && pagesOverBudget > 0) {
      const message =
        `${pagesOverBudget} page(s) had content streams that exceeded the decompression budget `
        + "and no other page yielded text";
      return {
        decoded: false,
        reason: "decoder.budget_exceeded",
        message,
        diagnostics: [{ code: "decoder.budget_exceeded", severity: "warning", message }, ...budgetNotes],
      };
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
    diagnostics.push(...budgetNotes);
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
