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
exports.decodeTextBlocks = decodeTextBlocks;
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
// 1.1.0: a leading byte-order mark is not part of line 1, and an ATX closing
// sequence (`## Status ##`) is not part of the heading text.
exports.TEXT_DECODER_VERSION = "1.1.0";
exports.CSV_DECODER_ID = "l9.csv-decoder";
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
exports.CSV_DECODER_VERSION = "1.2.0";
/** Read a file as UTF-8, refusing bytes that are not valid UTF-8. */
function readUtf8(input) {
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
function isSpace(char) {
    return char !== undefined && /\s/.test(char);
}
/** Characters `.` does not match; content containing one never matched the old expressions. */
function isLineTerminator(char) {
    return char === "\n" || char === "\r" || char === "\u2028" || char === "\u2029";
}
/**
 * The content of `line` between `from` and its last non-whitespace character,
 * or null when there is none or it holds a line terminator. One pass.
 */
function trimmedContent(line, from) {
    let start = from;
    while (start < line.length && isSpace(line[start]))
        start += 1;
    let end = line.length;
    while (end > start && isSpace(line[end - 1]))
        end -= 1;
    if (end <= start)
        return null;
    for (let index = start; index < end; index += 1) {
        if (isLineTerminator(line[index]))
            return null;
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
function classifyAtxHeading(line) {
    let level = 0;
    while (level < line.length && line[level] === "#")
        level += 1;
    if (level < 1 || level > 6 || !isSpace(line[level]))
        return null;
    const content = trimmedContent(line, level);
    if (content === null)
        return null;
    let hashes = content.length;
    while (hashes > 0 && content[hashes - 1] === "#")
        hashes -= 1;
    if (hashes < content.length && hashes > 0 && isSpace(content[hashes - 1])) {
        let end = hashes - 1;
        while (end > 0 && isSpace(content[end - 1]))
            end -= 1;
        if (end > 0)
            return { level, text: content.slice(0, end) };
    }
    return { level, text: content };
}
/**
 * A list item: optional indentation, `-`, `*`, `+` or digits with `.`/`)`,
 * whitespace, then content. The linear form of
 * `/^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/`.
 */
function classifyListItem(line) {
    let index = 0;
    while (index < line.length && isSpace(line[index]))
        index += 1;
    const marker = line[index];
    if (marker === "-" || marker === "*" || marker === "+") {
        index += 1;
    }
    else {
        const digits = index;
        while (index < line.length && line[index] >= "0" && line[index] <= "9")
            index += 1;
        if (index === digits || (line[index] !== "." && line[index] !== ")"))
            return null;
        index += 1;
    }
    if (!isSpace(line[index]))
        return null;
    return trimmedContent(line, index);
}
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
function lineSpanScope() {
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
function decodeTextBlocks(text, builder, markdown, scope = lineSpanScope()) {
    const lines = text.split(/\r?\n/);
    let paragraph = [];
    let paragraphStart = 1;
    let fence = null;
    let fenceStart = 1;
    let fenceLines = [];
    const flushParagraph = (endLine) => {
        if (paragraph.length === 0)
            return;
        builder.add("paragraph", paragraph.join("\n"), scope.locate(paragraphStart, endLine));
        paragraph = [];
    };
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
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
                fence = fenceMatch[1];
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
                if (kind === "title")
                    scope.title.seen = true;
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
        if (paragraph.length === 0)
            paragraphStart = lineNumber;
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
/**
 * One block per populated cell of a row, under its column's name.
 *
 * The row block stays: a row naming a blocker is worth citing as a row. These are
 * what make one *field* of it a readable statement rather than a fragment of a
 * joined string — `owner: mel; status: blocked` offers a reader `owner` and
 * nothing else, because a declaration is read up to its first colon.
 */
function addCsvCellBlocks(builder, header, cells, rowNumber) {
    for (let column = 0; column < cells.length; column += 1) {
        const value = cells[column].trim();
        const name = header[column].trim();
        if (value.length === 0 || name.length === 0)
            continue;
        builder.add("cell", `${name}: ${value}`, {
            kind: "csv_row",
            row_number: rowNumber,
            column: name,
        });
        if (builder.isFull)
            return;
    }
}
/**
 * The records of a delimited file, each with the physical line it starts on.
 *
 * A newline ends a record only outside quotes. Quote state is the parity of the
 * `"` characters since the record began — the same toggling `splitCsvLine`
 * applies, with `""` toggling twice — so the two agree on where a quoted field
 * ends. A quote still open at end of file leaves the rest as one record, so no
 * content is dropped, and is reported.
 */
function csvRecords(text) {
    const records = [];
    let start = 0;
    let startLine = 1;
    let line = 1;
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === '"') {
            quoted = !quoted;
            continue;
        }
        if (char !== "\n")
            continue;
        line += 1;
        if (quoted)
            continue;
        const end = index > start && text[index - 1] === "\r" ? index - 1 : index;
        records.push({ text: text.slice(start, end), line: startLine });
        start = index + 1;
        startLine = line;
    }
    if (start < text.length)
        records.push({ text: text.slice(start), line: startLine });
    return { records, unterminatedAt: quoted ? startLine : null };
}
/**
 * One block per non-empty record, plus one per populated cell, and the rows read.
 *
 * The row number is the line number in the file a record starts on, so a row is
 * citable at the place an operator would look for it even though blank lines are
 * skipped and a quoted cell may span several lines.
 */
function addCsvRowBlocks(builder, text, delimiter) {
    const rows = [];
    let header = [];
    const { records, unterminatedAt } = csvRecords(text);
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
        if (line.trim().length === 0)
            continue;
        const cells = splitCsvLine(line, delimiter);
        if (rows.length === 0)
            header = cells;
        rows.push(cells);
        // Each row is a block so a row naming a blocker is citable as a row rather
        // than as "somewhere in this file".
        const labelled = header.length === cells.length && rows.length > 1;
        const label = labelled
            ? cells.map((cell, column) => `${header[column]}: ${cell}`).join("; ")
            : cells.join(" | ");
        builder.add("cell", label, { kind: "csv_row", row_number: rowNumber });
        if (!builder.isFull && labelled)
            addCsvCellBlocks(builder, header, cells, rowNumber);
        if (builder.isFull)
            break;
    }
    return rows;
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
        const rows = addCsvRowBlocks(builder, read.text, delimiter);
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