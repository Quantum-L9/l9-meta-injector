"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.xlsxDecoder = exports.pptxDecoder = exports.docxDecoder = exports.XLSX_DECODER_VERSION = exports.XLSX_DECODER_ID = exports.PPTX_DECODER_VERSION = exports.PPTX_DECODER_ID = exports.DOCX_DECODER_VERSION = exports.DOCX_DECODER_ID = void 0;
// office.ts — Word, PowerPoint and Excel, read for what they say.
//
// Each of these formats keeps its text somewhere different, and each has its own
// idea of where a piece of text *is*. A Word paragraph has an index within a
// part. A PowerPoint shape has a slide number and a shape index. A spreadsheet
// value has a sheet and a cell reference. This file resists the temptation to
// flatten those into one fake coordinate, because a locator that cannot be
// checked against the source is not evidence.
//
// What none of them do: evaluate a formula, execute a macro, follow a
// relationship, or render anything. A spreadsheet formula is read as the text it
// declares. That is a deliberate limit — `=SUM(A1:A9)` tells you the sheet
// computes a total, and computing it here would be inventing a value the
// operator never saw.
const decoder_1 = require("./decoder");
const ooxml_1 = require("./ooxml");
const xml_1 = require("./xml");
exports.DOCX_DECODER_ID = "l9.docx-decoder";
exports.DOCX_DECODER_VERSION = "1.0.0";
exports.PPTX_DECODER_ID = "l9.pptx-decoder";
exports.PPTX_DECODER_VERSION = "1.0.0";
exports.XLSX_DECODER_ID = "l9.xlsx-decoder";
exports.XLSX_DECODER_VERSION = "1.0.0";
/** Turn an OOXML failure into the decode outcome it deserves. */
function ooxmlFailure(error) {
    if (error instanceof ooxml_1.OoxmlError) {
        const reason = error.code === "encrypted"
            ? "decoder.encrypted"
            : error.code === "budget"
                ? "decoder.budget_exceeded"
                : "decoder.malformed";
        return {
            decoded: false,
            reason,
            message: error.message,
            diagnostics: [{ code: reason, severity: "warning", message: error.message }],
        };
    }
    if (error instanceof xml_1.XmlError) {
        return {
            decoded: false,
            reason: "decoder.malformed",
            message: error.message,
            diagnostics: [{ code: "decoder.malformed", severity: "warning", message: error.message }],
        };
    }
    throw error;
}
/** The declared core properties: what the document says about itself. */
function coreProperties(container, maxDepth) {
    const xml = container.readPart("docProps/core.xml");
    if (xml === null)
        return {};
    const wanted = new Map([["title", "title"], ["subject", "subject"], ["keywords", "keywords"], ["category", "category"]]);
    const metadata = {};
    let current = null;
    try {
        (0, xml_1.parseXml)(xml, maxDepth, (event) => {
            if (event.type === "open") {
                current = wanted.get(event.name.toLowerCase()) ?? null;
                return;
            }
            if (event.type === "text" && current !== null) {
                metadata[current] = (metadata[current] ?? "") + event.text;
                return;
            }
            if (event.type === "close")
                current = null;
        });
    }
    catch (error) {
        if (!(error instanceof xml_1.XmlError))
            throw error;
    }
    return metadata;
}
// ───────────────────────────── docx ─────────────────────────────
/**
 * A Word paragraph's style name, which is how a heading announces itself.
 *
 * Word does not mark a heading with a heading element; it marks it with a style
 * whose name begins "Heading". A document using a custom style is therefore read
 * as prose, which is the honest outcome — the style is all the file says.
 */
function docxParagraphKind(style, listLevel) {
    if (style !== null) {
        const normalized = style.toLowerCase();
        if (normalized === "title")
            return "title";
        if (normalized.startsWith("heading") || /^h[1-9]$/.test(normalized))
            return "heading";
    }
    return listLevel !== null ? "list_item" : "paragraph";
}
exports.docxDecoder = {
    id: exports.DOCX_DECODER_ID,
    version: exports.DOCX_DECODER_VERSION,
    format: "docx",
    extensions: [".docx", ".docm"],
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
        let container;
        try {
            container = (0, ooxml_1.openOoxml)(input.absolutePath, input.budget);
        }
        catch (error) {
            return ooxmlFailure(error);
        }
        const documentId = (0, decoder_1.normalizedDocumentId)({
            contentHash: input.contentHash,
            decoderId: exports.DOCX_DECODER_ID,
            decoderVersion: exports.DOCX_DECODER_VERSION,
        });
        const builder = new decoder_1.BlockBuilder(documentId, input.budget);
        const part = "word/document.xml";
        const xml = container.readPart(part);
        if (xml === null) {
            const message = "word/document.xml is absent or was refused";
            return {
                decoded: false,
                reason: "decoder.malformed",
                message,
                diagnostics: [...container.diagnostics, { code: "decoder.malformed", severity: "warning", message }],
            };
        }
        let blockIndex = 0;
        let style = null;
        let listLevel = null;
        let runs = [];
        let inTable = false;
        let tableRows = [];
        let tableRow = [];
        let cellRuns = [];
        let tableStartIndex = 0;
        // Word encodes deletions as `w:delText`; reading them would resurrect text
        // the author removed and present it as current content.
        let suppressText = 0;
        try {
            (0, xml_1.parseXml)(xml, input.budget.maxDepth, (event) => {
                if (builder.isFull)
                    return false;
                if (event.type === "open") {
                    switch (event.name) {
                        case "del":
                        case "delText":
                            suppressText += 1;
                            return;
                        case "pStyle":
                            style = event.attributes["w:val"] ?? event.attributes.val ?? null;
                            return;
                        case "ilvl":
                            listLevel = Number.parseInt(event.attributes["w:val"] ?? event.attributes.val ?? "", 10);
                            if (!Number.isFinite(listLevel))
                                listLevel = null;
                            return;
                        case "tbl":
                            inTable = true;
                            tableRows = [];
                            tableStartIndex = blockIndex;
                            return;
                        case "tr":
                            tableRow = [];
                            return;
                        case "tc":
                            cellRuns = [];
                            return;
                        case "tab":
                            runs.push("\t");
                            return;
                        case "br":
                        case "cr":
                            runs.push("\n");
                            return;
                        default:
                            return;
                    }
                }
                if (event.type === "text") {
                    if (suppressText > 0)
                        return;
                    runs.push(event.text);
                    return;
                }
                // close
                switch (event.name) {
                    case "del":
                    case "delText":
                        suppressText = Math.max(0, suppressText - 1);
                        return;
                    case "p": {
                        const text = runs.join("");
                        runs = [];
                        if (inTable) {
                            cellRuns.push(text);
                            style = null;
                            listLevel = null;
                            return;
                        }
                        blockIndex += 1;
                        builder.add(docxParagraphKind(style, listLevel), text, {
                            kind: "docx_block",
                            block_index: blockIndex,
                            part,
                        });
                        style = null;
                        listLevel = null;
                        return;
                    }
                    case "tc":
                        tableRow.push(cellRuns.join("\n"));
                        cellRuns = [];
                        return;
                    case "tr":
                        tableRows.push(tableRow);
                        tableRow = [];
                        return;
                    case "tbl":
                        inTable = false;
                        blockIndex += 1;
                        builder.addTable(tableRows, {
                            kind: "docx_block",
                            block_index: tableStartIndex + 1,
                            part,
                        });
                        tableRows = [];
                        return;
                    default:
                        return;
                }
            });
        }
        catch (error) {
            return ooxmlFailure(error);
        }
        for (const diagnostic of container.diagnostics)
            builder.note(diagnostic);
        for (const diagnostic of (0, ooxml_1.noteExternalRelationships)(container, input.budget))
            builder.note(diagnostic);
        return {
            decoded: true,
            document: (0, decoder_1.buildNormalizedDocument)({
                decoder: { id: exports.DOCX_DECODER_ID, version: exports.DOCX_DECODER_VERSION, format: "docx" },
                decodeInput: input,
                documentId,
                metadata: coreProperties(container, input.budget.maxDepth),
                builder,
            }),
        };
    },
};
// ───────────────────────────── pptx ─────────────────────────────
/** `ppt/slides/slide12.xml` sorts after `slide2.xml`, which a string sort does not. */
function slideOrder(name) {
    const match = /slide(\d+)\.xml$/.exec(name);
    return match === null ? Number.MAX_SAFE_INTEGER : Number.parseInt(match[1], 10);
}
exports.pptxDecoder = {
    id: exports.PPTX_DECODER_ID,
    version: exports.PPTX_DECODER_VERSION,
    format: "pptx",
    extensions: [".pptx", ".pptm"],
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
        let container;
        try {
            container = (0, ooxml_1.openOoxml)(input.absolutePath, input.budget);
        }
        catch (error) {
            return ooxmlFailure(error);
        }
        const documentId = (0, decoder_1.normalizedDocumentId)({
            contentHash: input.contentHash,
            decoderId: exports.PPTX_DECODER_ID,
            decoderVersion: exports.PPTX_DECODER_VERSION,
        });
        const builder = new decoder_1.BlockBuilder(documentId, input.budget);
        const slides = container
            .partNames()
            .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
            .sort((a, b) => slideOrder(a) - slideOrder(b));
        if (slides.length === 0) {
            const message = "presentation holds no slide parts";
            return {
                decoded: false,
                reason: "decoder.malformed",
                message,
                diagnostics: [...container.diagnostics, { code: "decoder.malformed", severity: "warning", message }],
            };
        }
        const readShapes = (part, slideNumber, noteKind) => {
            const xml = container.readPart(part);
            if (xml === null)
                return;
            let shapeIndex = 0;
            let runs = [];
            let paragraphs = [];
            let isTitle = false;
            let inTable = false;
            let tableRows = [];
            let tableRow = [];
            try {
                (0, xml_1.parseXml)(xml, input.budget.maxDepth, (event) => {
                    if (builder.isFull)
                        return false;
                    if (event.type === "open") {
                        switch (event.name) {
                            case "ph":
                                // A placeholder of type `title` or `ctrTitle` is the slide's title.
                                if (["title", "ctrTitle"].includes(event.attributes.type ?? ""))
                                    isTitle = true;
                                return;
                            case "tbl":
                                inTable = true;
                                tableRows = [];
                                return;
                            case "tr":
                                tableRow = [];
                                return;
                            case "br":
                                runs.push("\n");
                                return;
                            default:
                                return;
                        }
                    }
                    if (event.type === "text") {
                        runs.push(event.text);
                        return;
                    }
                    switch (event.name) {
                        case "p": {
                            const text = runs.join("");
                            runs = [];
                            if (text.trim().length > 0)
                                paragraphs.push(text);
                            return;
                        }
                        case "tc":
                            tableRow.push(paragraphs.join("\n"));
                            paragraphs = [];
                            return;
                        case "tr":
                            tableRows.push(tableRow);
                            tableRow = [];
                            return;
                        case "tbl": {
                            inTable = false;
                            shapeIndex += 1;
                            builder.addTable(tableRows, {
                                kind: "pptx_shape",
                                slide_number: slideNumber,
                                shape_index: shapeIndex,
                                part,
                            });
                            tableRows = [];
                            paragraphs = [];
                            return;
                        }
                        case "sp":
                        case "graphicFrame": {
                            if (inTable)
                                return;
                            const text = paragraphs.join("\n");
                            paragraphs = [];
                            if (text.trim().length === 0) {
                                isTitle = false;
                                return;
                            }
                            shapeIndex += 1;
                            const kind = noteKind ?? (isTitle ? "title" : "paragraph");
                            isTitle = false;
                            builder.add(kind, text, {
                                kind: "pptx_shape",
                                slide_number: slideNumber,
                                shape_index: shapeIndex,
                                part,
                            });
                            return;
                        }
                        default:
                            return;
                    }
                });
            }
            catch (error) {
                if (!(error instanceof xml_1.XmlError))
                    throw error;
                builder.note({
                    code: "decoder.malformed",
                    severity: "warning",
                    message: `slide part '${part}' could not be parsed: ${error.message}`,
                    part,
                });
            }
        };
        for (const slide of slides) {
            const slideNumber = slideOrder(slide);
            readShapes(slide, slideNumber, null);
            // Speaker notes hold the argument behind the slide, which is often where
            // the actual plan lives.
            const notes = `ppt/notesSlides/notesSlide${slideNumber}.xml`;
            if (container.entries.has(notes))
                readShapes(notes, slideNumber, "note");
            if (builder.isFull)
                break;
        }
        for (const diagnostic of container.diagnostics)
            builder.note(diagnostic);
        for (const diagnostic of (0, ooxml_1.noteExternalRelationships)(container, input.budget))
            builder.note(diagnostic);
        return {
            decoded: true,
            document: (0, decoder_1.buildNormalizedDocument)({
                decoder: { id: exports.PPTX_DECODER_ID, version: exports.PPTX_DECODER_VERSION, format: "pptx" },
                decodeInput: input,
                documentId,
                metadata: coreProperties(container, input.budget.maxDepth),
                builder,
            }),
        };
    },
};
// ───────────────────────────── xlsx ─────────────────────────────
/** The shared-string table every cell value indexes into. */
function readSharedStrings(container, maxDepth) {
    const xml = container.readPart("xl/sharedStrings.xml");
    if (xml === null)
        return [];
    const strings = [];
    let runs = [];
    let depth = 0;
    try {
        (0, xml_1.parseXml)(xml, maxDepth, (event) => {
            if (event.type === "open" && event.name === "si") {
                depth += 1;
                runs = [];
                return;
            }
            if (event.type === "text" && depth > 0) {
                runs.push(event.text);
                return;
            }
            if (event.type === "close" && event.name === "si") {
                depth = Math.max(0, depth - 1);
                strings.push(runs.join(""));
                runs = [];
            }
        });
    }
    catch (error) {
        if (!(error instanceof xml_1.XmlError))
            throw error;
    }
    return strings;
}
/** Sheet names in workbook order, paired with their part paths. */
function readSheets(container, maxDepth) {
    const workbook = container.readPart("xl/workbook.xml");
    const names = [];
    if (workbook !== null) {
        try {
            (0, xml_1.parseXml)(workbook, maxDepth, (event) => {
                if (event.type === "open" && event.name === "sheet") {
                    names.push(event.attributes.name ?? `Sheet${names.length + 1}`);
                }
            });
        }
        catch (error) {
            if (!(error instanceof xml_1.XmlError))
                throw error;
        }
    }
    const parts = container
        .partNames()
        .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
        .sort((a, b) => {
        const left = /sheet(\d+)\.xml$/.exec(a);
        const right = /sheet(\d+)\.xml$/.exec(b);
        return Number.parseInt(left?.[1] ?? "0", 10) - Number.parseInt(right?.[1] ?? "0", 10);
    });
    return parts.map((part, index) => ({ name: names[index] ?? `Sheet${index + 1}`, part }));
}
exports.xlsxDecoder = {
    id: exports.XLSX_DECODER_ID,
    version: exports.XLSX_DECODER_VERSION,
    format: "xlsx",
    extensions: [".xlsx", ".xlsm"],
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
        let container;
        try {
            container = (0, ooxml_1.openOoxml)(input.absolutePath, input.budget);
        }
        catch (error) {
            return ooxmlFailure(error);
        }
        const documentId = (0, decoder_1.normalizedDocumentId)({
            contentHash: input.contentHash,
            decoderId: exports.XLSX_DECODER_ID,
            decoderVersion: exports.XLSX_DECODER_VERSION,
        });
        const builder = new decoder_1.BlockBuilder(documentId, input.budget);
        const shared = readSharedStrings(container, input.budget.maxDepth);
        const sheets = readSheets(container, input.budget.maxDepth);
        if (sheets.length === 0) {
            const message = "workbook holds no worksheet parts";
            return {
                decoded: false,
                reason: "decoder.malformed",
                message,
                diagnostics: [...container.diagnostics, { code: "decoder.malformed", severity: "warning", message }],
            };
        }
        let sawFormula = false;
        for (const sheet of sheets) {
            const xml = container.readPart(sheet.part);
            if (xml === null)
                continue;
            let reference = "";
            let cellType = "";
            let value = [];
            let formula = [];
            let inValue = false;
            let inFormula = false;
            let inInline = false;
            const rows = new Map();
            try {
                (0, xml_1.parseXml)(xml, input.budget.maxDepth, (event) => {
                    if (builder.isFull)
                        return false;
                    if (event.type === "open") {
                        switch (event.name) {
                            case "c":
                                reference = event.attributes.r ?? "";
                                cellType = event.attributes.t ?? "";
                                value = [];
                                formula = [];
                                return;
                            case "v":
                                inValue = true;
                                return;
                            case "f":
                                inFormula = true;
                                return;
                            case "is":
                                inInline = true;
                                return;
                            default:
                                return;
                        }
                    }
                    if (event.type === "text") {
                        if (inFormula)
                            formula.push(event.text);
                        else if (inValue || inInline)
                            value.push(event.text);
                        return;
                    }
                    switch (event.name) {
                        case "v":
                            inValue = false;
                            return;
                        case "f":
                            inFormula = false;
                            return;
                        case "is":
                            inInline = false;
                            return;
                        case "c": {
                            const raw = value.join("");
                            // `t="s"` means the value is an index into the shared-string table.
                            const text = cellType === "s"
                                ? shared[Number.parseInt(raw, 10)] ?? ""
                                : raw;
                            const declared = formula.join("");
                            // A formula is carried as the text it declares. Evaluating it would
                            // produce a number the operator never wrote down.
                            const savedSuffix = text.length > 0 ? ` (last saved value: ${text})` : "";
                            const rendered = declared.length > 0 ? `=${declared}${savedSuffix}` : text;
                            if (declared.length > 0)
                                sawFormula = true;
                            if (rendered.trim().length > 0 && reference.length > 0) {
                                builder.add("cell", rendered, {
                                    kind: "spreadsheet_cell",
                                    sheet: sheet.name,
                                    cell_or_range: reference,
                                });
                                const rowMatch = /(\d+)$/.exec(reference);
                                if (rowMatch !== null) {
                                    const rowNumber = Number.parseInt(rowMatch[1], 10);
                                    const row = rows.get(rowNumber) ?? [];
                                    row.push(rendered);
                                    rows.set(rowNumber, row);
                                }
                            }
                            reference = "";
                            cellType = "";
                            value = [];
                            formula = [];
                            return;
                        }
                        default:
                            return;
                    }
                });
            }
            catch (error) {
                if (!(error instanceof xml_1.XmlError))
                    throw error;
                builder.note({
                    code: "decoder.malformed",
                    severity: "warning",
                    message: `worksheet '${sheet.name}' could not be parsed: ${error.message}`,
                    part: sheet.part,
                });
                continue;
            }
            if (rows.size > 0) {
                const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
                builder.addTable(ordered, {
                    kind: "spreadsheet_cell",
                    sheet: sheet.name,
                    cell_or_range: "A1",
                });
            }
            // The sheet name itself is often the plan: "Q3 Roadmap", "Blocked".
            builder.add("heading", sheet.name, {
                kind: "spreadsheet_cell",
                sheet: sheet.name,
                cell_or_range: "A1",
            });
            if (builder.isFull)
                break;
        }
        if (sawFormula) {
            builder.note({
                code: "decoder.unsupported_feature",
                severity: "info",
                message: "formulas were read as the text they declare and were not evaluated",
            });
        }
        for (const diagnostic of container.diagnostics)
            builder.note(diagnostic);
        for (const diagnostic of (0, ooxml_1.noteExternalRelationships)(container, input.budget))
            builder.note(diagnostic);
        return {
            decoded: true,
            document: (0, decoder_1.buildNormalizedDocument)({
                decoder: { id: exports.XLSX_DECODER_ID, version: exports.XLSX_DECODER_VERSION, format: "xlsx" },
                decodeInput: input,
                documentId,
                metadata: coreProperties(container, input.budget.maxDepth),
                builder,
            }),
        };
    },
};
//# sourceMappingURL=office.js.map