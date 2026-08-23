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
exports.csvDecoder = exports.textDecoder = exports.CSV_DECODER_VERSION = exports.CSV_DECODER_ID = exports.TEXT_DECODER_VERSION = exports.TEXT_DECODER_ID = void 0;
exports.readUtf8 = readUtf8;
exports.splitCsvLine = splitCsvLine;
// text.ts — the formats that are already text, and the two that nearly are.
//
// Markdown, plain text, and the structured-config family decode by being read.
// What this file adds is structure: a Markdown heading becomes a `heading` block
// citing its line span, so the same work-signal extractors that read a heading in
// a Word document read one here, and a consumer never has to know which format a
// block came from in order to use it.
const fs = __importStar(require("node:fs"));
const decoder_1 = require("./decoder");
exports.TEXT_DECODER_ID = "l9.text-decoder";
exports.TEXT_DECODER_VERSION = "1.0.0";
exports.CSV_DECODER_ID = "l9.csv-decoder";
exports.CSV_DECODER_VERSION = "1.0.0";
/** Read a file as UTF-8, refusing bytes that are not valid UTF-8. */
function readUtf8(input) {
    if (input.sizeBytes > input.budget.maxSourceBytes) {
        return { reason: `file exceeds the ${input.budget.maxSourceBytes}-byte decoder ceiling` };
    }
    const bytes = fs.readFileSync(input.absolutePath);
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
function decodeTextBlocks(text, builder, markdown) {
    const lines = text.split(/\r?\n/);
    let paragraph = [];
    let paragraphStart = 1;
    let fence = null;
    let fenceStart = 1;
    let fenceLines = [];
    let sawTitle = false;
    const flushParagraph = (endLine) => {
        if (paragraph.length === 0)
            return;
        builder.add("paragraph", paragraph.join("\n"), {
            kind: "line_span",
            line_start: paragraphStart,
            line_end: endLine,
        });
        paragraph = [];
    };
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
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
                fence = fenceMatch[1];
                fenceStart = lineNumber;
                fenceLines = [];
                continue;
            }
            const atx = /^(#{1,6})\s+(.*\S)\s*#*\s*$/.exec(line);
            if (atx !== null) {
                flushParagraph(lineNumber - 1);
                const level = atx[1].length;
                const heading = atx[2];
                // The first level-1 heading is the document's title. Later ones are
                // headings: a file with three `#` sections has one title, not three.
                const kind = level === 1 && !sawTitle ? "title" : "heading";
                if (kind === "title")
                    sawTitle = true;
                builder.add(kind, heading, { kind: "line_span", line_start: lineNumber, line_end: lineNumber });
                continue;
            }
            const listItem = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/.exec(line);
            if (listItem !== null) {
                flushParagraph(lineNumber - 1);
                builder.add("list_item", listItem[1], {
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
        if (paragraph.length === 0)
            paragraphStart = lineNumber;
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
exports.textDecoder = {
    id: exports.TEXT_DECODER_ID,
    version: exports.TEXT_DECODER_VERSION,
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
    decode(input) {
        const read = readUtf8(input);
        if ("reason" in read) {
            return {
                decoded: false,
                reason: "decoder.malformed",
                message: read.reason,
                diagnostics: [{ code: "decoder.malformed", severity: "warning", message: read.reason }],
            };
        }
        const documentId = (0, decoder_1.normalizedDocumentId)({
            contentHash: input.contentHash,
            decoderId: exports.TEXT_DECODER_ID,
            decoderVersion: exports.TEXT_DECODER_VERSION,
        });
        const builder = new decoder_1.BlockBuilder(documentId, input.budget);
        const basename = input.sourcePath.slice(input.sourcePath.lastIndexOf("/") + 1).toLowerCase();
        const dot = basename.lastIndexOf(".");
        const markdown = dot > 0 && MARKDOWN_EXTENSIONS.has(basename.slice(dot));
        decodeTextBlocks(read.text, builder, markdown);
        const title = builder.finish().blocks.find((block) => block.kind === "title");
        return {
            decoded: true,
            document: (0, decoder_1.buildNormalizedDocument)({
                decoder: { id: exports.TEXT_DECODER_ID, version: exports.TEXT_DECODER_VERSION, format: markdown ? "markdown" : "text" },
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
function splitCsvLine(line, delimiter) {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (quoted) {
            if (char === '"') {
                if (line[index + 1] === '"') {
                    cell += '"';
                    index += 1;
                }
                else {
                    quoted = false;
                }
            }
            else {
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
exports.csvDecoder = {
    id: exports.CSV_DECODER_ID,
    version: exports.CSV_DECODER_VERSION,
    format: "csv",
    extensions: [".csv", ".tsv"],
    decode(input) {
        const read = readUtf8(input);
        if ("reason" in read) {
            return {
                decoded: false,
                reason: "decoder.malformed",
                message: read.reason,
                diagnostics: [{ code: "decoder.malformed", severity: "warning", message: read.reason }],
            };
        }
        const documentId = (0, decoder_1.normalizedDocumentId)({
            contentHash: input.contentHash,
            decoderId: exports.CSV_DECODER_ID,
            decoderVersion: exports.CSV_DECODER_VERSION,
        });
        const builder = new decoder_1.BlockBuilder(documentId, input.budget);
        const delimiter = input.sourcePath.toLowerCase().endsWith(".tsv") ? "\t" : ",";
        const lines = read.text.split(/\r?\n/);
        const rows = [];
        let header = [];
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (line.trim().length === 0)
                continue;
            const cells = splitCsvLine(line, delimiter);
            const rowNumber = index + 1;
            if (rows.length === 0)
                header = cells;
            rows.push(cells);
            // Each row is a block so a row naming a blocker is citable as a row rather
            // than as "somewhere in this file".
            const label = header.length === cells.length && rows.length > 1
                ? cells.map((cell, column) => `${header[column]}: ${cell}`).join("; ")
                : cells.join(" | ");
            builder.add("cell", label, { kind: "csv_row", row_number: rowNumber });
            if (builder.isFull)
                break;
        }
        if (rows.length > 0) {
            builder.addTable(rows, { kind: "csv_row", row_number: 1 });
        }
        return {
            decoded: true,
            document: (0, decoder_1.buildNormalizedDocument)({
                decoder: { id: exports.CSV_DECODER_ID, version: exports.CSV_DECODER_VERSION, format: "csv" },
                decodeInput: input,
                documentId,
                metadata: {},
                builder,
            }),
        };
    },
};
//# sourceMappingURL=text.js.map