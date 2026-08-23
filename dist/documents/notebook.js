"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notebookDecoder = exports.NOTEBOOK_DECODER_VERSION = exports.NOTEBOOK_DECODER_ID = void 0;
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
const decoder_1 = require("./decoder");
const text_1 = require("./text");
exports.NOTEBOOK_DECODER_ID = "l9.ipynb-decoder";
exports.NOTEBOOK_DECODER_VERSION = "1.0.0";
/** Notebook `source` is either a string or an array of lines. */
function sourceToText(source) {
    if (typeof source === "string")
        return source;
    if (Array.isArray(source)) {
        return source.filter((line) => typeof line === "string").join("");
    }
    return "";
}
/** Metadata worth carrying: names the notebook declares, never anything executable. */
function safeMetadata(metadata) {
    if (metadata === null || typeof metadata !== "object")
        return {};
    const record = metadata;
    const out = {};
    const title = record.title;
    if (typeof title === "string")
        out.title = title;
    const kernelspec = record.kernelspec;
    if (kernelspec !== null && typeof kernelspec === "object") {
        const name = kernelspec.display_name;
        if (typeof name === "string")
            out.kernel = name;
    }
    const language = record.language_info;
    if (language !== null && typeof language === "object") {
        const name = language.name;
        if (typeof name === "string")
            out.language = name;
    }
    return out;
}
exports.notebookDecoder = {
    id: exports.NOTEBOOK_DECODER_ID,
    version: exports.NOTEBOOK_DECODER_VERSION,
    format: "ipynb",
    extensions: [".ipynb"],
    decode(input) {
        const read = (0, text_1.readUtf8)(input);
        if ("reason" in read) {
            return {
                decoded: false,
                reason: "decoder.malformed",
                message: read.reason,
                diagnostics: [{ code: "decoder.malformed", severity: "warning", message: read.reason }],
            };
        }
        let parsed;
        try {
            parsed = JSON.parse(read.text);
        }
        catch (error) {
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
        const notebook = parsed;
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
        const documentId = (0, decoder_1.normalizedDocumentId)({
            contentHash: input.contentHash,
            decoderId: exports.NOTEBOOK_DECODER_ID,
            decoderVersion: exports.NOTEBOOK_DECODER_VERSION,
        });
        const builder = new decoder_1.BlockBuilder(documentId, input.budget);
        let sawTitle = false;
        for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
            const cell = cells[cellIndex];
            if (cell === null || typeof cell !== "object")
                continue;
            const record = cell;
            const cellType = typeof record.cell_type === "string" ? record.cell_type : "unknown";
            const text = sourceToText(record.source);
            if (text.trim().length === 0)
                continue;
            const lines = text.split(/\r?\n/);
            const locate = (start, end) => ({
                kind: "notebook_cell",
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
            let paragraph = [];
            let paragraphStart = 1;
            const flush = (endLine) => {
                if (paragraph.length === 0)
                    return;
                builder.add("paragraph", paragraph.join("\n"), locate(paragraphStart, endLine));
                paragraph = [];
            };
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
                const line = lines[lineIndex];
                const lineNumber = lineIndex + 1;
                const atx = /^(#{1,6})\s+(.*\S)\s*#*\s*$/.exec(line);
                if (atx !== null) {
                    flush(lineNumber - 1);
                    const level = atx[1].length;
                    const kind = level === 1 && !sawTitle ? "title" : "heading";
                    if (kind === "title")
                        sawTitle = true;
                    builder.add(kind, atx[2], locate(lineNumber, lineNumber));
                    continue;
                }
                const listItem = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/.exec(line);
                if (listItem !== null) {
                    flush(lineNumber - 1);
                    builder.add("list_item", listItem[1], locate(lineNumber, lineNumber));
                    continue;
                }
                if (line.trim().length === 0) {
                    flush(lineNumber - 1);
                    continue;
                }
                if (paragraph.length === 0)
                    paragraphStart = lineNumber;
                paragraph.push(line);
            }
            flush(lines.length);
            if (builder.isFull)
                break;
        }
        const hasOutputs = cells.some((cell) => cell !== null
            && typeof cell === "object"
            && Array.isArray(cell.outputs)
            && cell.outputs.length > 0);
        if (hasOutputs) {
            builder.note({
                code: "decoder.unsupported_feature",
                severity: "info",
                message: "cell outputs are present and were not read: only cell source is decoded, and no cell was executed",
            });
        }
        return {
            decoded: true,
            document: (0, decoder_1.buildNormalizedDocument)({
                decoder: { id: exports.NOTEBOOK_DECODER_ID, version: exports.NOTEBOOK_DECODER_VERSION, format: "ipynb" },
                decodeInput: input,
                documentId,
                metadata: safeMetadata(notebook.metadata),
                builder,
            }),
        };
    },
};
//# sourceMappingURL=notebook.js.map