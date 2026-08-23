"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DecoderRegistry = exports.BlockBuilder = exports.DEFAULT_DECODER_BUDGET = exports.NORMALIZED_DOCUMENT_SCHEMA = exports.DECODER_DIAGNOSTIC_CODES = exports.LOCATOR_KINDS = exports.BLOCK_KINDS = exports.DOCUMENT_FORMATS = void 0;
exports.normalizedDocumentId = normalizedDocumentId;
exports.blockId = blockId;
exports.buildNormalizedDocument = buildNormalizedDocument;
// decoder.ts — the boundary where bytes become a document this corpus can read.
//
// Everything upstream of here deals in exact bytes: hashes, archive members,
// duplicate clusters. Everything downstream deals in text: keyphrases, topic
// candidates, work signals. This module is the seam, and its job is to make the
// crossing honest.
//
// Two rules shape the whole design.
//
// A decoder never fabricates a location. A Markdown file has line numbers, so a
// Markdown block cites lines. A PowerPoint shape does not have line numbers, and
// inventing them so every format looks alike would produce evidence that cannot
// be checked against the source. So a locator is a discriminated union: each
// format cites the coordinate its own format actually has, and a consumer that
// meets an unfamiliar locator kind knows it is unfamiliar rather than being
// handed a plausible lie.
//
// A decoder never reports empty success. A scanned PDF holds no text layer; a
// password-protected workbook holds nothing readable at all. Returning zero
// blocks for those would be indistinguishable from a document that genuinely had
// nothing to say, and an operator would read "0 findings" as "nothing there"
// rather than "we could not look". Every failure to read is a typed outcome with
// a reason, and coverage counts it.
const ordering_1 = require("../ordering");
const repository_model_1 = require("../repository_model");
/** Every document format this release can turn into blocks. */
exports.DOCUMENT_FORMATS = [
    "text",
    "markdown",
    "csv",
    "html",
    "ipynb",
    "pdf",
    "docx",
    "pptx",
    "xlsx",
];
/**
 * What a block is, semantically.
 *
 * Deliberately small and closed. A richer vocabulary would let each decoder
 * invent its own categories, and the work-signal extractors downstream would
 * then have to know which decoder produced a block in order to read it.
 */
exports.BLOCK_KINDS = [
    "title",
    "heading",
    "paragraph",
    "list_item",
    "code",
    "table",
    "note",
    "cell",
];
/** The locator kinds, exposed so a consumer can assert it handles them all. */
exports.LOCATOR_KINDS = [
    "line_span",
    "notebook_cell",
    "pdf_page_block",
    "docx_block",
    "pptx_shape",
    "spreadsheet_cell",
    "csv_row",
    "html_node",
];
/** Why a decoder could not produce what it was asked for. */
exports.DECODER_DIAGNOSTIC_CODES = [
    "decoder.encrypted",
    "decoder.ocr_required",
    "decoder.unsupported_feature",
    "decoder.malformed",
    "decoder.budget_exceeded",
    "decoder.external_reference_not_followed",
    "decoder.macro_present_not_executed",
    "decoder.truncated",
];
exports.NORMALIZED_DOCUMENT_SCHEMA = "l9.normalized-document/v1";
exports.DEFAULT_DECODER_BUDGET = {
    maxSourceBytes: 64 * 1024 * 1024,
    maxTextBytes: 8 * 1024 * 1024,
    maxBlocks: 50000,
    maxContainerEntries: 4096,
    maxPartBytes: 32 * 1024 * 1024,
    maxCompressionRatio: 200,
    maxDepth: 64,
};
/**
 * Identity of a normalized document.
 *
 * Bound to the exact bytes and to the decoder that read them, and to nothing
 * else. Two artifacts holding identical bytes produce one normalized document
 * identity, which is what lets the cache serve one to both; a decoder revision
 * produces a different one, which is what stops last release's reading being
 * presented as this release's.
 */
function normalizedDocumentId(input) {
    return (0, repository_model_1.stableId)("normdoc", {
        content_hash: input.contentHash,
        decoder_id: input.decoderId,
        decoder_version: input.decoderVersion,
    });
}
/** Identity of one block within a document. */
function blockId(normalizedDocumentIdValue, ordinal) {
    return (0, repository_model_1.stableId)("block", {
        normalized_document_id: normalizedDocumentIdValue,
        ordinal,
    });
}
/**
 * Collects blocks while holding the budget, so no decoder has to remember to.
 *
 * Truncation is recorded rather than silent: a document that hit a ceiling says
 * so in its diagnostics, and coverage can tell a short document from a curtailed
 * one.
 */
class BlockBuilder {
    constructor(documentId, budget) {
        this.documentId = documentId;
        this.budget = budget;
        this.blocks = [];
        this.tables = [];
        this.links = [];
        this.diagnostics = [];
        this.textBytes = 0;
        this.truncated = false;
        this.ordinal = 0;
    }
    /** True once a ceiling has been reached and further content is being dropped. */
    get isFull() {
        return this.truncated;
    }
    add(kind, text, locator) {
        const trimmed = text.trim();
        if (trimmed.length === 0)
            return;
        if (this.truncated)
            return;
        if (this.blocks.length >= this.budget.maxBlocks) {
            this.markTruncated(`block ceiling of ${this.budget.maxBlocks} reached`);
            return;
        }
        const bytes = Buffer.byteLength(trimmed, "utf8");
        if (this.textBytes + bytes > this.budget.maxTextBytes) {
            this.markTruncated(`text ceiling of ${this.budget.maxTextBytes} bytes reached`);
            return;
        }
        this.textBytes += bytes;
        this.ordinal += 1;
        this.blocks.push({
            block_id: blockId(this.documentId, this.ordinal),
            kind,
            text: trimmed,
            locator,
        });
    }
    addTable(rows, locator) {
        if (this.truncated)
            return;
        const cleaned = rows
            .map((row) => row.map((cell) => cell.trim()))
            .filter((row) => row.some((cell) => cell.length > 0));
        if (cleaned.length === 0)
            return;
        this.ordinal += 1;
        this.tables.push({
            table_id: blockId(this.documentId, this.ordinal),
            locator,
            rows: cleaned,
        });
        // A table is also readable prose. Emitting it as a block too is what lets a
        // roadmap laid out as a table be found by the same keyphrase pass that finds
        // one written as paragraphs.
        this.add("table", cleaned.map((row) => row.join(" | ")).join("\n"), locator);
    }
    addLink(href, text, locator) {
        if (this.truncated)
            return;
        if (href.trim().length === 0)
            return;
        if (this.links.length >= this.budget.maxBlocks)
            return;
        this.links.push({ href: href.trim(), text: text.trim(), locator });
    }
    note(diagnostic) {
        this.diagnostics.push(diagnostic);
    }
    markTruncated(message) {
        this.truncated = true;
        this.diagnostics.push({
            code: "decoder.truncated",
            severity: "warning",
            message: `document was truncated: ${message}`,
        });
    }
    finish() {
        return {
            blocks: this.blocks,
            tables: this.tables,
            links: this.links,
            diagnostics: [...this.diagnostics].sort((a, b) => (0, ordering_1.compareCodePoints)(a.code, b.code) || (0, ordering_1.compareCodePoints)(a.message, b.message)),
        };
    }
}
exports.BlockBuilder = BlockBuilder;
/** Assemble a decoded document from a builder's contents. */
function buildNormalizedDocument(input) {
    const { blocks, tables, links, diagnostics } = input.builder.finish();
    return {
        schema: exports.NORMALIZED_DOCUMENT_SCHEMA,
        normalized_document_id: input.documentId,
        artifact_id: input.decodeInput.artifactId,
        source_content_hash: input.decodeInput.contentHash,
        format: input.decoder.format,
        decoder_id: input.decoder.id,
        decoder_version: input.decoder.version,
        metadata: Object.fromEntries(Object.entries(input.metadata)
            .filter(([, value]) => value.trim().length > 0)
            .sort(([a], [b]) => (0, ordering_1.compareCodePoints)(a, b))),
        blocks,
        tables,
        links,
        diagnostics,
    };
}
/**
 * The decoders available, keyed by the extensions they claim.
 *
 * One decoder per extension. Two decoders competing for `.xml` would make which
 * one ran a function of registration order, and the normalized document identity
 * carries the decoder id — so the corpus identity would silently depend on
 * module load order.
 */
class DecoderRegistry {
    constructor() {
        this.byExtension = new Map();
        this.byFilename = new Map();
        this.decoders = [];
    }
    register(decoder) {
        const claim = (map, key, what) => {
            const existing = map.get(key);
            if (existing !== undefined && existing.id !== decoder.id) {
                throw new Error(`decoder-registry: ${what} '${key}' is claimed by both '${existing.id}' and '${decoder.id}'`);
            }
            map.set(key, decoder);
        };
        for (const extension of decoder.extensions)
            claim(this.byExtension, extension, "extension");
        for (const filename of decoder.filenames ?? [])
            claim(this.byFilename, filename, "filename");
        this.decoders.push(decoder);
    }
    /** The decoder that claims this path, or undefined when none does. */
    forPath(sourcePath) {
        const basename = sourcePath.slice(sourcePath.lastIndexOf("/") + 1).toLowerCase();
        const named = this.byFilename.get(basename);
        if (named !== undefined)
            return named;
        const dot = basename.lastIndexOf(".");
        if (dot <= 0)
            return undefined;
        return this.byExtension.get(basename.slice(dot));
    }
    /** Every registered decoder, ordered by id so a profile is reproducible. */
    all() {
        return [...this.decoders].sort((a, b) => (0, ordering_1.compareCodePoints)(a.id, b.id));
    }
    /** Every claimed extension, in code-point order. */
    extensions() {
        return [...this.byExtension.keys()].sort(ordering_1.compareCodePoints);
    }
    /** Every claimed whole filename, in code-point order. */
    filenames() {
        return [...this.byFilename.keys()].sort(ordering_1.compareCodePoints);
    }
    /** `id@version` for every decoder: the analysis-identity contribution. */
    profile() {
        return this.all().map((decoder) => `${decoder.id}@${decoder.version}`);
    }
}
exports.DecoderRegistry = DecoderRegistry;
//# sourceMappingURL=decoder.js.map