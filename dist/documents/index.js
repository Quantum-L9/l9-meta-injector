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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROSE_DOCUMENT_FORMATS = exports.OCR_CANDIDATE_EXTENSIONS = exports.UNSUPPORTED_LEGACY_EXTENSIONS = exports.XmlError = exports.parseXml = exports.localName = exports.decodeXmlText = exports.OoxmlError = exports.openOoxml = exports.isSafePartName = exports.pdfInternals = exports.pdfDecoder = exports.notebookDecoder = exports.tokenizeHtml = exports.htmlDecoder = exports.xlsxDecoder = exports.pptxDecoder = exports.docxDecoder = exports.csvDecoder = exports.textDecoder = exports.splitCsvLine = exports.readUtf8 = void 0;
exports.isProseDocumentFormat = isProseDocumentFormat;
exports.defaultDecoderRegistry = defaultDecoderRegistry;
exports.decoderProfile = decoderProfile;
// index.ts — the decoders this release ships, and the formats it refuses.
//
// Two lists matter here and they are both closed. `defaultDecoderRegistry`
// decides what can be read; `UNSUPPORTED_LEGACY_EXTENSIONS` names what cannot,
// so an operator meeting an old `.doc` gets told it is an unsupported legacy
// format rather than finding it silently absent from every count.
//
// The refusal list is deliberate about what it will not do. Converting a `.doc`
// by shelling out to a converter would turn a read-only observer into a process
// launcher, and the guess it produced would carry no provenance worth having.
const decoder_1 = require("./decoder");
const text_1 = require("./text");
const office_1 = require("./office");
const html_1 = require("./html");
const notebook_1 = require("./notebook");
const pdf_1 = require("./pdf");
__exportStar(require("./decoder"), exports);
var text_2 = require("./text");
Object.defineProperty(exports, "readUtf8", { enumerable: true, get: function () { return text_2.readUtf8; } });
Object.defineProperty(exports, "splitCsvLine", { enumerable: true, get: function () { return text_2.splitCsvLine; } });
Object.defineProperty(exports, "textDecoder", { enumerable: true, get: function () { return text_2.textDecoder; } });
Object.defineProperty(exports, "csvDecoder", { enumerable: true, get: function () { return text_2.csvDecoder; } });
var office_2 = require("./office");
Object.defineProperty(exports, "docxDecoder", { enumerable: true, get: function () { return office_2.docxDecoder; } });
Object.defineProperty(exports, "pptxDecoder", { enumerable: true, get: function () { return office_2.pptxDecoder; } });
Object.defineProperty(exports, "xlsxDecoder", { enumerable: true, get: function () { return office_2.xlsxDecoder; } });
var html_2 = require("./html");
Object.defineProperty(exports, "htmlDecoder", { enumerable: true, get: function () { return html_2.htmlDecoder; } });
Object.defineProperty(exports, "tokenizeHtml", { enumerable: true, get: function () { return html_2.tokenizeHtml; } });
var notebook_2 = require("./notebook");
Object.defineProperty(exports, "notebookDecoder", { enumerable: true, get: function () { return notebook_2.notebookDecoder; } });
var pdf_2 = require("./pdf");
Object.defineProperty(exports, "pdfDecoder", { enumerable: true, get: function () { return pdf_2.pdfDecoder; } });
Object.defineProperty(exports, "pdfInternals", { enumerable: true, get: function () { return pdf_2.pdfInternals; } });
var ooxml_1 = require("./ooxml");
Object.defineProperty(exports, "isSafePartName", { enumerable: true, get: function () { return ooxml_1.isSafePartName; } });
Object.defineProperty(exports, "openOoxml", { enumerable: true, get: function () { return ooxml_1.openOoxml; } });
Object.defineProperty(exports, "OoxmlError", { enumerable: true, get: function () { return ooxml_1.OoxmlError; } });
var xml_1 = require("./xml");
Object.defineProperty(exports, "decodeXmlText", { enumerable: true, get: function () { return xml_1.decodeXmlText; } });
Object.defineProperty(exports, "localName", { enumerable: true, get: function () { return xml_1.localName; } });
Object.defineProperty(exports, "parseXml", { enumerable: true, get: function () { return xml_1.parseXml; } });
Object.defineProperty(exports, "XmlError", { enumerable: true, get: function () { return xml_1.XmlError; } });
/**
 * Formats whose containers this release cannot open.
 *
 * The pre-2007 Office formats are OLE compound documents, a different container
 * entirely from the OOXML ZIP that `docxDecoder` and its siblings read. `.pages`
 * is an Apple bundle, `.odt` an OpenDocument ZIP with a different part layout,
 * `.epub` a third ZIP shape again. Each is counted explicitly in coverage: an
 * operator with a shelf of `.doc` files should see how many, not discover the
 * gap by noticing the total does not add up.
 *
 * This list and `defaultDecoderRegistry` are the two halves of one closed
 * statement, and neither may claim an extension the other does; `documentGaps`
 * in `corpus_coverage` asserts exactly that.
 */
exports.UNSUPPORTED_LEGACY_EXTENSIONS = [
    ".doc", ".epub", ".key", ".numbers", ".odp", ".ods", ".odt",
    ".pages", ".ppt", ".rtf", ".wpd", ".xls",
];
/** Formats that hold no text layer at all and need OCR to say anything. */
exports.OCR_CANDIDATE_EXTENSIONS = [
    ".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg",
    ".png", ".tif", ".tiff", ".webp",
];
/**
 * Formats whose normalized text is prose in its entirety.
 *
 * This decides which decoded documents enter the corpus's lexical analysis —
 * shingles, term counts, and through them near-duplicate and topic candidates —
 * and it is a statement about the format rather than about the extension.
 *
 * The `text` and `markdown` families are deliberately absent. Their decoder
 * claims `.ts`, `.py` and `.sql` alongside `.md` and `.txt`, and source code is
 * not prose: shingling a repository's TypeScript would report every file that
 * shares an import block as a near-duplicate of every other. Those formats keep
 * the extension gate they already had (`NEAR_DUPLICATE_EXTENSIONS`).
 *
 * Everything here is prose or tabular content by construction — a Word document,
 * a deck, a sheet, a notebook's markdown cells, a saved page, a CSV — so there is
 * no extension left to consult. Without this list a decoded `.docx` would be
 * counted in coverage and reach no candidate at all, which is a decoder that
 * looks wired and is not.
 */
exports.PROSE_DOCUMENT_FORMATS = [
    "csv", "docx", "html", "ipynb", "pdf", "pptx", "xlsx",
];
/** Whether a decoded document of this format enters lexical analysis. */
function isProseDocumentFormat(format) {
    return exports.PROSE_DOCUMENT_FORMATS.includes(format);
}
/** The registry every corpus run uses unless a caller supplies its own. */
function defaultDecoderRegistry() {
    const registry = new decoder_1.DecoderRegistry();
    registry.register(text_1.textDecoder);
    registry.register(text_1.csvDecoder);
    registry.register(notebook_1.notebookDecoder);
    registry.register(html_1.htmlDecoder);
    registry.register(pdf_1.pdfDecoder);
    registry.register(office_1.docxDecoder);
    registry.register(office_1.pptxDecoder);
    registry.register(office_1.xlsxDecoder);
    return registry;
}
/** `id@version` for every shipped decoder: the analysis-identity contribution. */
function decoderProfile() {
    return defaultDecoderRegistry().profile();
}
//# sourceMappingURL=index.js.map