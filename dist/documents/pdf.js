"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.pdfInternals = exports.pdfDecoder = exports.PDF_DECODER_VERSION = exports.PDF_DECODER_ID = void 0;
exports.parsePdfDict = parsePdfDict;
// pdf.ts — native-text PDF, and an honest refusal for everything else.
//
// A PDF is an object graph with a cross-reference index, and its text lives in
// content streams as operators rather than as a text field. Extracting it means
// locating the objects, expanding object streams (`/Type /ObjStm`), following the
// latest trailer's `/Root` down the page tree, inflating content streams,
// tokenizing them, and mapping byte codes through whatever encoding the page's
// fonts declare. Objects are located by scanning for their headers rather than by
// trusting the xref, for the reason `scanObjects` gives; references between them
// are then resolved through that one object table.
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
const fs = __importStar(require("node:fs"));
const zlib = __importStar(require("node:zlib"));
const decoder_1 = require("./decoder");
exports.PDF_DECODER_ID = "l9.pdf-decoder";
exports.PDF_DECODER_VERSION = "1.2.0";
const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
function isWhitespace(byte) {
    return WHITESPACE.has(byte);
}
function isDelimiter(byte) {
    return [0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25].includes(byte);
}
/**
 * Split a dictionary's body into key/value text, balancing nested structures.
 *
 * A regex cannot do this: `/Font << /F1 5 0 R >>` nests, and a naive match would
 * stop at the first `>>`.
 */
function parsePdfDict(body) {
    const dict = new Map();
    let cursor = 0;
    while (cursor < body.length) {
        while (cursor < body.length && body[cursor] !== "/")
            cursor += 1;
        if (cursor >= body.length)
            break;
        cursor += 1;
        const nameStart = cursor;
        while (cursor < body.length && !/[\s/[\]<>()]/.test(body[cursor]))
            cursor += 1;
        const key = body.slice(nameStart, cursor);
        while (cursor < body.length && /\s/.test(body[cursor]))
            cursor += 1;
        const valueStart = cursor;
        let depth = 0;
        while (cursor < body.length) {
            const char = body[cursor];
            if (char === "<" && body[cursor + 1] === "<") {
                depth += 1;
                cursor += 2;
                continue;
            }
            if (char === ">" && body[cursor + 1] === ">") {
                if (depth === 0)
                    break;
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
            // Strings are skipped whole: a title may contain `/`, `>>` or `]`.
            if (char === "(") {
                cursor = scanLiteral(body, cursor).end + 1;
                continue;
            }
            if (char === "<") {
                const close = body.indexOf(">", cursor);
                cursor = close < 0 ? body.length : close + 1;
                continue;
            }
            if (char === "/" && depth === 0 && cursor > valueStart)
                break;
            cursor += 1;
        }
        dict.set(key, body.slice(valueStart, cursor).trim());
    }
    return dict;
}
/** The dictionary text of an object body, or null when it has none. */
function dictBody(source) {
    const open = source.indexOf("<<");
    if (open < 0)
        return null;
    let depth = 0;
    for (let cursor = open; cursor < source.length - 1; cursor += 1) {
        if (source[cursor] === "<" && source[cursor + 1] === "<") {
            depth += 1;
            cursor += 1;
            continue;
        }
        if (source[cursor] === ">" && source[cursor + 1] === ">") {
            depth -= 1;
            if (depth === 0)
                return source.slice(open + 2, cursor);
            cursor += 1;
            continue;
        }
        if (source[cursor] === "(") {
            cursor = scanLiteral(source, cursor).end;
            continue;
        }
        if (source[cursor] === "<") {
            const close = source.indexOf(">", cursor);
            if (close < 0)
                return null;
            cursor = close;
        }
    }
    return null;
}
/**
 * A balanced literal string opening at `open`: its raw text and where it closes.
 *
 * The one scanner for literal strings, shared by the content-stream tokenizer
 * and by dictionary values (a document title is one). `end` is the index of the
 * closing parenthesis, or the end of the source when the string never closes;
 * every step advances, so an unterminated string costs one pass.
 */
function scanLiteral(source, open) {
    let depth = 1;
    let index = open + 1;
    let raw = "";
    while (index < source.length && depth > 0) {
        const inner = source[index];
        if (inner === "\\") {
            raw += inner + (source[index + 1] ?? "");
            index += 2;
            continue;
        }
        if (inner === "(")
            depth += 1;
        if (inner === ")") {
            depth -= 1;
            if (depth === 0)
                break;
        }
        raw += inner;
        index += 1;
    }
    return { raw, end: index };
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
function scanObjects(text) {
    const objects = new Map();
    const inFileOrder = [];
    const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
    let match = pattern.exec(text);
    while (match !== null) {
        const object = { offset: match.index, bound: text.length };
        inFileOrder.push(object);
        objects.set(Number.parseInt(match[1], 10), object);
        match = pattern.exec(text);
    }
    for (let index = 0; index + 1 < inFileOrder.length; index += 1) {
        inFileOrder[index].bound = inFileOrder[index + 1].offset;
    }
    return objects;
}
/**
 * The aggregate allowance for one PDF.
 *
 * `maxPartBytes` bounds one decompressed stream, as it bounds one OOXML part.
 * `maxCompressionRatio` bounds the document as a whole: all of its decompressed
 * stream bytes together may not exceed that multiple of the file's own size, and
 * never more than four streams' worth of `maxPartBytes`.
 */
function inflateAllowance(budget, sourceBytes) {
    const perStream = Math.max(1, budget.maxPartBytes);
    const total = Math.max(1, Math.min(budget.maxCompressionRatio * sourceBytes, 4 * perStream));
    return { perStream, total, remaining: total, skipped: 0 };
}
/**
 * Inflate a stream, tolerating the trailing-garbage real PDFs often carry.
 *
 * zlib itself enforces the ceiling (`maxOutputLength`), so a stream cannot
 * produce more than it is allowed however it is built. A stream that hits the
 * ceiling is over budget, which is a different fact from a corrupt one: the
 * strategy loop stops there instead of trying the next way to read it.
 */
function inflate(raw, allowance) {
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
        }
        catch (error) {
            if (error.code === "ERR_BUFFER_TOO_LARGE") {
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
/** The object number of an `N G R` reference, or null when the value is not one. */
function referenceNumber(value) {
    const match = /^(\d+)\s+\d+\s+R$/.exec((value ?? "").trim());
    return match === null ? null : Number.parseInt(match[1], 10);
}
/**
 * The bytes and objects of one PDF, with every object read at most once.
 *
 * A body is a slice of the file's own text, so caching every body costs no
 * copy; the passes over the document (fonts, pages, images, content) reuse them
 * rather than re-reading a window of the file per object per pass.
 */
class PdfFile {
    constructor(bytes, text, objects, allowance) {
        this.bytes = bytes;
        this.text = text;
        this.objects = objects;
        this.allowance = allowance;
        this.parts = new Map();
        /** Streams that did not decode, kept so a refused stream is not tried twice. */
        this.failedStreams = new Map();
        /** What reading the file's structure found worth saying: budget, malformation. */
        this.notes = [];
        this.trailerCache = null;
    }
    /** The body, dictionary and stream position of an object. */
    partsOf(object) {
        const cached = this.parts.get(object);
        if (cached !== undefined)
            return cached;
        if (object.inStream !== undefined) {
            const memberDict = dictBody(object.inStream.body);
            const member = {
                body: object.inStream.body,
                dict: parsePdfDict(memberDict ?? ""),
                isDict: memberDict !== null,
                streamStart: -1,
                bodyEnd: object.offset,
            };
            this.parts.set(object, member);
            return member;
        }
        const extent = this.text.slice(object.offset, object.bound);
        const start = extent.indexOf("obj");
        let parts;
        if (start < 0) {
            parts = { body: "", dict: new Map(), isDict: false, streamStart: -1, bodyEnd: object.offset };
        }
        else {
            const end = extent.indexOf("endobj", start);
            const body = extent.slice(start + 3, end < 0 ? extent.length : end);
            const bodyStart = object.offset + start + 3;
            const marker = body.indexOf("stream");
            let streamStart = -1;
            if (marker >= 0) {
                streamStart = bodyStart + marker + "stream".length;
                if (this.bytes[streamStart] === 0x0d)
                    streamStart += 1;
                if (this.bytes[streamStart] === 0x0a)
                    streamStart += 1;
            }
            const inner = dictBody(body);
            parts = {
                body,
                dict: parsePdfDict(inner ?? ""),
                isDict: inner !== null,
                streamStart,
                bodyEnd: bodyStart + body.length,
            };
        }
        this.parts.set(object, parts);
        return parts;
    }
    /** The raw body of one object, from `obj` to its matching `endobj`. */
    objectBody(object) {
        return this.partsOf(object).body;
    }
    /** The bytes of an object's stream, decoded when the filter is one we support. */
    streamBytes(object, number) {
        const failed = this.failedStreams.get(object);
        if (failed !== undefined)
            return failed;
        const result = this.readStream(object, number);
        if (result.kind !== "ok")
            this.failedStreams.set(object, result);
        return result;
    }
    readStream(object, number) {
        const { dict, streamStart: start, bodyEnd } = this.partsOf(object);
        if (start < 0)
            return { kind: "unreadable" };
        // A direct /Length must be an integer; `N G R` is resolved through the object
        // table. Anything else — an unresolvable reference, a reference to something
        // that is not an integer — is no length at all, and the stream is delimited
        // by its `endstream` instead of by the leading digits of a reference.
        const declared = this.integerOf(dict.get("Length"));
        let end;
        if (declared !== null && declared > 0 && start + declared <= this.bytes.length) {
            end = start + declared;
        }
        else {
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
                this.notes.push({
                    code: "decoder.budget_exceeded",
                    severity: "warning",
                    message: `object ${number}'s stream decompresses to more than the ${result.ceiling}-byte `
                        + "per-stream ceiling and was not read",
                    part: `object ${number}`,
                });
            }
            return result;
        }
        if (filter.length === 0)
            return { kind: "ok", bytes: raw };
        // DCTDecode, JPXDecode and friends are images; CCITTFaxDecode is a fax scan.
        // None of them holds text, and pretending otherwise would fabricate content.
        return { kind: "unreadable" };
    }
    /** The object a value refers to, when the value is an indirect reference. */
    resolve(value) {
        const number = referenceNumber(value);
        return number === null ? undefined : this.objects.get(number);
    }
    /** A dictionary value, given inline or by reference; null when it is neither. */
    dictOf(value) {
        if (value === undefined)
            return null;
        const target = this.resolve(value);
        if (target !== undefined) {
            const parts = this.partsOf(target);
            return parts.isDict ? parts.dict : null;
        }
        const trimmed = value.trim();
        if (!trimmed.startsWith("<<"))
            return null;
        return parsePdfDict(dictBody(trimmed) ?? "");
    }
    /** An integer value, given directly or by reference; null when it is not one. */
    integerOf(value) {
        if (value === undefined)
            return null;
        const target = this.resolve(value);
        const text = target === undefined ? value.trim() : this.partsOf(target).body.trim();
        return /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;
    }
    /** The object numbers an array value lists, given inline or by reference. */
    referencesIn(value) {
        if (value === undefined)
            return [];
        const target = this.resolve(value);
        const text = target === undefined ? value : this.partsOf(target).body;
        if (target !== undefined && !text.trim().startsWith("["))
            return [referenceNumber(value)];
        return [...text.matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number.parseInt(match[1], 10));
    }
    /**
     * Expand every `/Type /ObjStm` into the object table.
     *
     * Since PDF 1.5 most objects of an exported document — its catalog, page tree
     * and fonts included — live inside object streams and nowhere else. A member
     * takes its stream's file position, so the table's later-wins rule applies to
     * it as to any other definition.
     */
    expandObjectStreams() {
        const streams = [...this.objects.entries()]
            .filter(([, object]) => object.inStream === undefined && this.partsOf(object).dict.get("Type") === "/ObjStm")
            .sort((a, b) => a[1].offset - b[1].offset);
        for (const [number, container] of streams) {
            const dict = this.partsOf(container).dict;
            const stream = this.streamBytes(container, number);
            if (stream.kind === "over_budget")
                continue;
            const count = this.integerOf(dict.get("N"));
            const first = this.integerOf(dict.get("First"));
            const text = stream.kind === "ok" ? stream.bytes.toString("latin1") : "";
            const header = first === null ? [] : (text.slice(0, first).match(/\d+/g) ?? []).map(Number);
            if (stream.kind !== "ok" || count === null || first === null || first > text.length || header.length < count * 2) {
                this.notes.push({
                    code: "decoder.malformed",
                    severity: "warning",
                    message: `object stream ${number} could not be read; the objects it holds were not found`,
                    part: `object ${number}`,
                });
                continue;
            }
            for (let index = 0; index < count; index += 1) {
                const member = header[index * 2];
                const start = first + header[index * 2 + 1];
                const end = index + 1 < count ? first + header[index * 2 + 3] : text.length;
                const existing = this.objects.get(member);
                if (existing !== undefined && existing.offset > container.offset)
                    continue;
                this.objects.set(member, {
                    offset: container.offset,
                    bound: container.bound,
                    inStream: { streamObject: number, index, body: text.slice(start, Math.max(start, end)) },
                });
            }
        }
    }
    /**
     * Trailer dictionaries, latest first.
     *
     * A classic file states them after the `trailer` keyword; a file with a
     * cross-reference stream has no such keyword and states the same keys in the
     * `/Type /XRef` stream's dictionary. An incremental update appends a newer one.
     */
    trailers() {
        if (this.trailerCache !== null)
            return this.trailerCache;
        const found = [];
        for (const match of this.text.matchAll(/trailer\s*<</g)) {
            const inner = dictBody(this.text.slice(match.index, match.index + 64 * 1024));
            if (inner !== null)
                found.push({ position: match.index, dict: parsePdfDict(inner) });
        }
        for (const object of new Set(this.objects.values())) {
            if (object.inStream !== undefined)
                continue;
            const parts = this.partsOf(object);
            if (parts.dict.get("Type") === "/XRef")
                found.push({ position: object.offset, dict: parts.dict });
        }
        this.trailerCache = found.sort((a, b) => b.position - a.position).map((entry) => entry.dict);
        return this.trailerCache;
    }
    /** The aggregate-allowance diagnostic, when the allowance ran out. */
    allowanceNote() {
        if (this.allowance.skipped === 0)
            return null;
        return {
            code: "decoder.budget_exceeded",
            severity: "warning",
            message: `the document's decompression allowance of ${this.allowance.total} bytes was exhausted; `
                + `${this.allowance.skipped} stream(s) were not inflated`,
        };
    }
}
/**
 * The document's pages, in page-tree order.
 *
 * A page's number is its position in the tree under the catalog the latest
 * trailer names — not its position in the file, which an incremental update
 * rewrites, and not its mere presence, since a page removed from `/Kids` is no
 * longer part of the document. The walk refuses to revisit a node and to descend
 * past `maxDepth`, and says so when either stops it. `null` means there was no
 * tree to walk.
 */
function walkPageTree(file, maxDepth) {
    let catalog = null;
    for (const trailer of file.trailers()) {
        catalog = file.dictOf(trailer.get("Root"));
        if (catalog !== null)
            break;
    }
    const rootPages = catalog?.get("Pages");
    if (catalog === null || file.resolve(rootPages) === undefined)
        return null;
    const pages = [];
    const visited = new Set();
    let revisited = 0;
    let tooDeep = 0;
    const visit = (number, depth, inherited) => {
        if (visited.has(number)) {
            revisited += 1;
            return;
        }
        visited.add(number);
        const object = file.objects.get(number);
        if (object === undefined)
            return;
        const parts = file.partsOf(object);
        if (!parts.isDict)
            return;
        const resources = parts.dict.get("Resources") ?? inherited;
        const type = parts.dict.get("Type");
        if (type === "/Page") {
            pages.push({ number, object, resources });
            return;
        }
        if (type !== "/Pages" && !parts.dict.has("Kids"))
            return;
        if (depth > maxDepth) {
            tooDeep += 1;
            return;
        }
        for (const kid of file.referencesIn(parts.dict.get("Kids")))
            visit(kid, depth + 1, resources);
    };
    visit(referenceNumber(rootPages), 1, undefined);
    if (revisited > 0) {
        file.notes.push({
            code: "decoder.malformed",
            severity: "warning",
            message: `the page tree refers back to a node it already visited ${revisited} time(s); the cycle was not followed`,
        });
    }
    if (tooDeep > 0) {
        file.notes.push({
            code: "decoder.budget_exceeded",
            severity: "warning",
            message: `${tooDeep} page-tree node(s) lie deeper than the ${maxDepth}-level ceiling and were not read`,
        });
    }
    return pages;
}
/** PDFDocEncoding's departures from Latin-1 (PDF 32000-1, Annex D). */
const PDF_DOC_ENCODING = {
    0x18: "\u02d8", 0x19: "\u02c7", 0x1a: "\u02c6", 0x1b: "\u02d9",
    0x1c: "\u02dd", 0x1d: "\u02db", 0x1e: "\u02da", 0x1f: "\u02dc",
    0x80: "\u2022", 0x81: "\u2020", 0x82: "\u2021", 0x83: "\u2026",
    0x84: "\u2014", 0x85: "\u2013", 0x86: "\u0192", 0x87: "\u2044",
    0x88: "\u2039", 0x89: "\u203a", 0x8a: "\u2212", 0x8b: "\u2030",
    0x8c: "\u201e", 0x8d: "\u201c", 0x8e: "\u201d", 0x8f: "\u2018",
    0x90: "\u2019", 0x91: "\u201a", 0x92: "\u2122", 0x93: "\ufb01",
    0x94: "\ufb02", 0x95: "\u0141", 0x96: "\u0152", 0x97: "\u0160",
    0x98: "\u0178", 0x99: "\u017d", 0x9a: "\u0131", 0x9b: "\u0142",
    0x9c: "\u0153", 0x9d: "\u0161", 0x9e: "\u017e", 0xa0: "\u20ac",
};
/**
 * A PDF text string — the type of a document's title — as Unicode.
 *
 * `bytes` holds one character per byte. A string is UTF-16BE when it opens with
 * the FE FF byte-order mark, UTF-8 when it opens with EF BB BF, and
 * PDFDocEncoding otherwise.
 */
function decodeTextString(bytes) {
    const raw = Buffer.from(bytes, "latin1");
    if (raw[0] === 0xfe && raw[1] === 0xff) {
        const body = raw.subarray(2, 2 + ((raw.length - 2) & ~1));
        const swapped = Buffer.from(body);
        swapped.swap16();
        return swapped.toString("utf16le");
    }
    if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
        return raw.subarray(3).toString("utf8");
    let out = "";
    for (const byte of raw)
        out += PDF_DOC_ENCODING[byte] ?? String.fromCharCode(byte);
    return out;
}
/** A string value — literal `( … )` or hex `< … >` — as its bytes, or null. */
function stringValue(value) {
    const trimmed = (value ?? "").trim();
    if (trimmed.startsWith("("))
        return decodeLiteral(scanLiteral(trimmed, 0).raw);
    if (trimmed.startsWith("<") && !trimmed.startsWith("<<")) {
        const close = trimmed.indexOf(">");
        let hex = trimmed.slice(1, close < 0 ? trimmed.length : close).replace(/[^0-9A-Fa-f]/g, "");
        if (hex.length % 2 === 1)
            hex += "0";
        return Buffer.from(hex, "hex").toString("latin1");
    }
    return null;
}
/**
 * The document's declared title: `/Title` of the `/Info` dictionary the latest
 * trailer names. A bookmark or annotation that happens to carry a `/Title` is
 * not the document's title and is never read as one.
 */
function documentTitle(file) {
    for (const trailer of file.trailers()) {
        if (!trailer.has("Info"))
            continue;
        const info = file.dictOf(trailer.get("Info"));
        const title = stringValue(info?.get("Title"));
        return title === null ? null : decodeTextString(title);
    }
    return null;
}
/** A PDF literal string, with its escape rules. */
function decodeLiteral(source) {
    let out = "";
    for (let cursor = 0; cursor < source.length; cursor += 1) {
        const char = source[cursor];
        if (char !== "\\") {
            out += char;
            continue;
        }
        const next = source[cursor + 1];
        if (next === undefined)
            break;
        cursor += 1;
        switch (next) {
            case "n":
                out += "\n";
                break;
            case "r":
                out += "\r";
                break;
            case "t":
                out += "\t";
                break;
            case "b":
                out += "\b";
                break;
            case "f":
                out += "\f";
                break;
            case "(":
                out += "(";
                break;
            case ")":
                out += ")";
                break;
            case "\\":
                out += "\\";
                break;
            case "\n": break;
            case "\r":
                if (source[cursor + 1] === "\n")
                    cursor += 1;
                break;
            default: {
                if (next >= "0" && next <= "7") {
                    let octal = next;
                    while (octal.length < 3) {
                        const digit = source[cursor + 1];
                        if (digit === undefined || digit < "0" || digit > "7")
                            break;
                        octal += digit;
                        cursor += 1;
                    }
                    out += String.fromCodePoint(Number.parseInt(octal, 8));
                }
                else {
                    out += next;
                }
            }
        }
    }
    return out;
}
/** A max-heap of row indices, so the latest row covering a code wins. */
class LatestRowHeap {
    constructor() {
        this.items = [];
    }
    get top() {
        return this.items[0];
    }
    push(value) {
        const items = this.items;
        items.push(value);
        let index = items.length - 1;
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (items[parent] >= value)
                break;
            items[index] = items[parent];
            index = parent;
        }
        items[index] = value;
    }
    pop() {
        const items = this.items;
        const last = items.pop();
        if (last === undefined || items.length === 0)
            return;
        let index = 0;
        for (;;) {
            const left = index * 2 + 1;
            if (left >= items.length)
                break;
            const right = left + 1;
            const child = right < items.length && items[right] > items[left] ? right : left;
            if (items[child] <= last)
                break;
            items[index] = items[child];
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
function flattenRanges(rows) {
    if (rows.length === 0)
        return [];
    const starts = new Map();
    const ends = new Map();
    rows.forEach((row, index) => {
        const opening = starts.get(row.low);
        if (opening === undefined)
            starts.set(row.low, [index]);
        else
            opening.push(index);
        const closing = ends.get(row.high + 1);
        if (closing === undefined)
            ends.set(row.high + 1, [index]);
        else
            closing.push(index);
    });
    const points = [...new Set([...starts.keys(), ...ends.keys()])].sort((a, b) => a - b);
    const closed = new Uint8Array(rows.length);
    const open = new LatestRowHeap();
    const segments = [];
    for (let index = 0; index + 1 < points.length; index += 1) {
        const point = points[index];
        for (const row of ends.get(point) ?? [])
            closed[row] = 1;
        for (const row of starts.get(point) ?? [])
            open.push(row);
        while (open.top !== undefined && closed[open.top] === 1)
            open.pop();
        if (open.top === undefined)
            continue;
        const row = rows[open.top];
        const high = points[index + 1] - 1;
        const previous = segments[segments.length - 1];
        if (previous !== undefined && previous.row === row && previous.high + 1 === point)
            previous.high = high;
        else
            segments.push({ low: point, high, row });
    }
    return segments;
}
const utf16Units = (hex) => {
    const units = [];
    for (let index = 0; index + 3 < hex.length + 1; index += 4) {
        const unit = Number.parseInt(hex.slice(index, index + 4), 16);
        if (Number.isFinite(unit))
            units.push(unit);
    }
    return units;
};
const unitsToText = (units) => {
    let out = "";
    for (const unit of units) {
        if (unit >= 0 && unit <= 0xffff)
            out += String.fromCharCode(unit);
        else if (unit >= 0 && unit <= 0x10ffff)
            out += String.fromCodePoint(unit);
    }
    return out;
};
const destTextForOffset = (hex, offset) => {
    const units = utf16Units(hex);
    if (units.length === 0)
        return "";
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
class ToUnicodeMap {
    constructor(chars, ranges) {
        this.chars = chars;
        this.segments = flattenRanges(ranges);
    }
    /** Number of rows that map something; zero means the CMap mapped nothing. */
    get size() {
        return this.chars.size + this.segments.length;
    }
    get(code) {
        let low = 0;
        let high = this.segments.length - 1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            const segment = this.segments[middle];
            if (code < segment.low)
                high = middle - 1;
            else if (code > segment.high)
                low = middle + 1;
            else
                return destTextForOffset(segment.row.dest, code - segment.row.low);
        }
        return this.chars.get(code);
    }
}
/** Several maps answered in order, the first that knows a code winning. */
class MergedLookup {
    constructor(maps) {
        this.maps = maps;
    }
    get(code) {
        for (const map of this.maps) {
            const value = map.get(code);
            if (value !== undefined)
                return value;
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
function parseToUnicode(cmap) {
    const chars = new Map();
    const charPattern = /beginbfchar([\s\S]*?)endbfchar/g;
    let block = charPattern.exec(cmap);
    while (block !== null) {
        const pairs = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
        let pair = pairs.exec(block[1]);
        while (pair !== null) {
            chars.set(Number.parseInt(pair[1], 16), unitsToText(utf16Units(pair[2])));
            pair = pairs.exec(block[1]);
        }
        block = charPattern.exec(cmap);
    }
    const ranges = [];
    const rangePattern = /beginbfrange([\s\S]*?)endbfrange/g;
    let range = rangePattern.exec(cmap);
    while (range !== null) {
        const rows = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
        let row = rows.exec(range[1]);
        while (row !== null) {
            const low = Number.parseInt(row[1], 16);
            const high = Number.parseInt(row[2], 16);
            if (Number.isFinite(low) && Number.isFinite(high) && high >= low && high - low < 65536) {
                ranges.push({ low, high, dest: row[3] });
            }
            row = rows.exec(range[1]);
        }
        range = rangePattern.exec(cmap);
    }
    return new ToUnicodeMap(chars, ranges);
}
/** Text-showing operators, turned into the strings they show. */
function extractContentText(content, toUnicode) {
    const lines = [];
    let line = [];
    let cursor = 0;
    const decodeHex = (hex) => {
        const clean = hex.replace(/[^0-9A-Fa-f]/g, "");
        let out = "";
        if (toUnicode !== null) {
            for (let index = 0; index + 1 < clean.length; index += 4) {
                const code = Number.parseInt(clean.slice(index, index + 4), 16);
                out += toUnicode.get(code) ?? "";
            }
            if (out.length > 0)
                return out;
        }
        for (let index = 0; index + 1 < clean.length; index += 2) {
            out += String.fromCodePoint(Number.parseInt(clean.slice(index, index + 2), 16));
        }
        return out;
    };
    const decodeShown = (raw, hex) => {
        if (hex)
            return decodeHex(raw);
        const literal = decodeLiteral(raw);
        if (toUnicode === null)
            return literal;
        // A simple font with a ToUnicode map still addresses single bytes.
        let out = "";
        for (const char of literal)
            out += toUnicode.get(char.charCodeAt(0)) ?? char;
        return out;
    };
    while (cursor < content.length) {
        const char = content[cursor];
        if (char === "(") {
            const { raw, end } = scanLiteral(content, cursor);
            line.push(decodeShown(raw, false));
            cursor = end + 1;
            continue;
        }
        if (char === "<" && content[cursor + 1] !== "<") {
            const end = content.indexOf(">", cursor);
            if (end < 0)
                break;
            line.push(decodeShown(content.slice(cursor + 1, end), true));
            cursor = end + 1;
            continue;
        }
        // `Td`, `TD`, `T*` and `'` all move to a new line; `ET` ends a text object.
        if (/^(T\*|TD|Td|ET|')/.test(content.slice(cursor))) {
            const joined = line.join("").trim();
            if (joined.length > 0)
                lines.push(joined);
            line = [];
            cursor += 2;
            continue;
        }
        cursor += 1;
    }
    const trailing = line.join("").trim();
    if (trailing.length > 0)
        lines.push(trailing);
    return lines;
}
/** Whether an object body declares an image XObject. */
function isImageObject(body) {
    return /\/Subtype\s*\/Image/.test(body);
}
exports.pdfDecoder = {
    id: exports.PDF_DECODER_ID,
    version: exports.PDF_DECODER_VERSION,
    format: "pdf",
    extensions: [".pdf"],
    decode(input) {
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
        file.expandObjectStreams();
        const documentId = (0, decoder_1.normalizedDocumentId)({
            contentHash: input.contentHash,
            decoderId: exports.PDF_DECODER_ID,
            decoderVersion: exports.PDF_DECODER_VERSION,
        });
        const builder = new decoder_1.BlockBuilder(documentId, input.budget);
        const diagnostics = [];
        // One ToUnicode map for the document. Per-font resolution would be more
        // precise; a single merged map is enough to read the overwhelming majority of
        // exported documents and never invents a character it has no mapping for.
        const cmaps = [];
        for (const [number, object] of objects) {
            const body = file.objectBody(object);
            if (!body.includes("/ToUnicode") && !body.includes("beginbfchar") && !body.includes("beginbfrange"))
                continue;
            const stream = file.streamBytes(object, number);
            if (stream.kind !== "ok")
                continue;
            const text = stream.bytes.toString("latin1");
            if (!text.includes("beginbfchar") && !text.includes("beginbfrange"))
                continue;
            const parsed = parseToUnicode(text);
            if (parsed.size === 0)
                continue;
            cmaps.push(parsed);
        }
        const toUnicode = cmaps.length === 0 ? null : new MergedLookup(cmaps);
        // Pages in page-tree order. Only when there is no tree to walk are the page
        // objects read in file order, and the document says that is what happened.
        let pages = walkPageTree(file, input.budget.maxDepth) ?? [];
        if (pages.length === 0) {
            pages = [...objects.entries()]
                .filter(([, object]) => file.partsOf(object).dict.get("Type") === "/Page")
                .sort((a, b) => a[1].offset - b[1].offset)
                .map(([number, object]) => ({ number, object, resources: file.partsOf(object).dict.get("Resources") }));
            if (pages.length > 0) {
                file.notes.push({
                    code: "decoder.malformed",
                    severity: "info",
                    message: "the page tree could not be resolved from the trailer's /Root; "
                        + `${pages.length} page object(s) were read in file order`,
                });
            }
        }
        if (pages.length === 0) {
            const message = "no page could be located in the document's page tree or among its objects";
            return {
                decoded: false,
                reason: "decoder.malformed",
                message,
                diagnostics: [{ code: "decoder.malformed", severity: "warning", message }, ...file.notes],
            };
        }
        let pagesWithText = 0;
        let pagesWithoutText = 0;
        let pagesOverBudget = 0;
        let imageObjects = 0;
        for (const [, object] of objects) {
            if (isImageObject(file.objectBody(object)))
                imageObjects += 1;
        }
        const readContent = (contents) => {
            const texts = [];
            let overBudget = false;
            for (const number of file.referencesIn(contents)) {
                const target = objects.get(number);
                if (target === undefined)
                    continue;
                const stream = file.streamBytes(target, number);
                if (stream.kind === "over_budget")
                    overBudget = true;
                if (stream.kind !== "ok")
                    continue;
                texts.push(...extractContentText(stream.bytes.toString("latin1"), toUnicode));
            }
            return { lines: texts, overBudget };
        };
        for (let index = 0; index < pages.length; index += 1) {
            if (builder.isFull)
                break;
            const page = pages[index];
            if (page === undefined)
                continue;
            const { lines, overBudget } = readContent(file.partsOf(page.object).dict.get("Contents"));
            if (lines.length === 0) {
                // A page whose content was refused for size is not a page without text;
                // calling it a scan would send an operator to OCR a document that has none.
                if (overBudget)
                    pagesOverBudget += 1;
                else
                    pagesWithoutText += 1;
                continue;
            }
            pagesWithText += 1;
            for (let blockIndex = 0; blockIndex < lines.length; blockIndex += 1) {
                const text = lines[blockIndex];
                // The first line of the first page is the closest thing a PDF has to a
                // declared title when its metadata carries none.
                const kind = index === 0 && blockIndex === 0 ? "title" : "paragraph";
                builder.add(kind, text, {
                    kind: "pdf_page_block",
                    page_number: index + 1,
                    block_index: blockIndex + 1,
                });
                if (builder.isFull)
                    break;
            }
        }
        const budgetNotes = [...file.notes];
        const allowanceNote = file.allowanceNote();
        if (allowanceNote !== null)
            budgetNotes.push(allowanceNote);
        // Nothing was read because what there was to read exceeded the budget: that
        // is the reason, not a scan and not an unsupported feature.
        if (pagesWithText === 0 && pagesOverBudget > 0) {
            const message = `${pagesOverBudget} page(s) had content streams that exceeded the decompression budget `
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
                ? `no text layer was found across ${pages.length} page(s); `
                    + `${imageObjects} image object(s) are present, so this is a scanned document requiring OCR`
                : "no text layer was found and no image objects are present; the document yielded nothing readable";
            return {
                decoded: false,
                reason: imageObjects > 0 ? "decoder.ocr_required" : "decoder.unsupported_feature",
                message,
                diagnostics: [
                    { code: imageObjects > 0 ? "decoder.ocr_required" : "decoder.unsupported_feature", severity: "warning", message },
                    ...budgetNotes,
                ],
            };
        }
        diagnostics.push(...budgetNotes);
        if (pagesWithoutText > 0) {
            diagnostics.push({
                code: "decoder.ocr_required",
                severity: "info",
                message: `${pagesWithoutText} of ${pages.length} page(s) carried no text layer and would need OCR; `
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
        for (const diagnostic of diagnostics)
            builder.note(diagnostic);
        const title = documentTitle(file);
        return {
            decoded: true,
            document: (0, decoder_1.buildNormalizedDocument)({
                decoder: { id: exports.PDF_DECODER_ID, version: exports.PDF_DECODER_VERSION, format: "pdf" },
                decodeInput: input,
                documentId,
                metadata: title !== null && title.length > 0 ? { title } : {},
                builder,
            }),
        };
    },
};
/** Exported for the decoder tests, which exercise the tokenizer directly. */
exports.pdfInternals = { parsePdfDict, extractContentText, parseToUnicode, decodeLiteral, isWhitespace, isDelimiter };
//# sourceMappingURL=pdf.js.map