/** Every document format this release can turn into blocks. */
export declare const DOCUMENT_FORMATS: readonly ["text", "markdown", "csv", "html", "ipynb", "pdf", "docx", "pptx", "xlsx"];
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];
/**
 * What a block is, semantically.
 *
 * Deliberately small and closed. A richer vocabulary would let each decoder
 * invent its own categories, and the work-signal extractors downstream would
 * then have to know which decoder produced a block in order to read it.
 */
export declare const BLOCK_KINDS: readonly ["title", "heading", "paragraph", "list_item", "code", "table", "note", "cell"];
export type BlockKind = (typeof BLOCK_KINDS)[number];
/**
 * Where a block came from, in the coordinate system its own format has.
 *
 * A slide has a slide number and a shape index. A worksheet has a sheet and a
 * cell reference. A PDF has a page and a block index within it. None of those is
 * a line number, and none of them is interchangeable with another.
 */
export type BlockLocator = {
    kind: "line_span";
    line_start: number;
    line_end: number;
} | {
    kind: "notebook_cell";
    cell_index: number;
    cell_type: string;
    line_start: number;
    line_end: number;
} | {
    kind: "pdf_page_block";
    page_number: number;
    block_index: number;
} | {
    kind: "docx_block";
    block_index: number;
    part: string;
} | {
    kind: "pptx_shape";
    slide_number: number;
    shape_index: number;
    part: string;
} | {
    kind: "spreadsheet_cell";
    sheet: string;
    cell_or_range: string;
} | {
    kind: "csv_row";
    row_number: number;
    column?: string;
} | {
    kind: "html_node";
    node_path: string;
    node_index: number;
};
/** The locator kinds, exposed so a consumer can assert it handles them all. */
export declare const LOCATOR_KINDS: readonly ["line_span", "notebook_cell", "pdf_page_block", "docx_block", "pptx_shape", "spreadsheet_cell", "csv_row", "html_node"];
export interface DocumentBlock {
    block_id: string;
    kind: BlockKind;
    text: string;
    locator: BlockLocator;
}
/** A table lifted out of a document, kept as rows of text. */
export interface DocumentTable {
    table_id: string;
    locator: BlockLocator;
    rows: string[][];
}
/**
 * A link a document declares.
 *
 * Recorded, never followed. A document that names an external resource is
 * evidence about the document; fetching it would make this package a client of
 * whatever an old archive happens to point at.
 */
export interface DocumentLink {
    href: string;
    text: string;
    locator: BlockLocator;
}
/** Why a decoder could not produce what it was asked for. */
export declare const DECODER_DIAGNOSTIC_CODES: readonly ["decoder.encrypted", "decoder.ocr_required", "decoder.unsupported_feature", "decoder.malformed", "decoder.budget_exceeded", "decoder.external_reference_not_followed", "decoder.macro_present_not_executed", "decoder.truncated"];
export type DecoderDiagnosticCode = (typeof DECODER_DIAGNOSTIC_CODES)[number];
export interface DecoderDiagnostic {
    code: DecoderDiagnosticCode;
    severity: "info" | "warning" | "error";
    message: string;
    /** The part of the document this is about, when the decoder can say. */
    part?: string;
}
export interface NormalizedDocument {
    schema: string;
    normalized_document_id: string;
    artifact_id: string;
    source_content_hash: string;
    format: DocumentFormat;
    decoder_id: string;
    decoder_version: string;
    /** Declared document metadata: title, author-free fields the format states. */
    metadata: Record<string, string>;
    blocks: DocumentBlock[];
    tables: DocumentTable[];
    links: DocumentLink[];
    diagnostics: DecoderDiagnostic[];
}
export declare const NORMALIZED_DOCUMENT_SCHEMA = "l9.normalized-document/v1";
/**
 * What a decoder returns.
 *
 * `decoded` is the honest half of the contract. A decoder that cannot read its
 * input says so with a reason, and the caller records a coverage gap of that
 * exact kind rather than an empty document.
 */
export type DecodeOutcome = {
    decoded: true;
    document: NormalizedDocument;
} | {
    decoded: false;
    reason: DecoderDiagnosticCode;
    message: string;
    diagnostics: DecoderDiagnostic[];
};
export interface DecodeInput {
    artifactId: string;
    /** `sha256:`-prefixed hash of the exact source bytes. */
    contentHash: string;
    /** Root-relative path, used for extension dispatch and never as identity. */
    sourcePath: string;
    /** Absolute path to the bytes. Staged copies are fine; the source is not written. */
    absolutePath: string;
    sizeBytes: number;
    budget: DecoderBudget;
}
/**
 * Ceilings every decoder honours.
 *
 * A document format is an attack surface — a spreadsheet can declare a billion
 * empty cells, an OOXML container can hold a zip bomb, a PDF can nest objects
 * until a naive parser recurses forever. These bounds are enforced by the
 * decoders rather than trusted from the file's own declarations.
 */
export interface DecoderBudget {
    /** Largest file a decoder will open at all. */
    maxSourceBytes: number;
    /** Largest total text a single document may yield. */
    maxTextBytes: number;
    /** Largest number of blocks a single document may yield. */
    maxBlocks: number;
    /** Largest number of entries an OOXML container may declare. */
    maxContainerEntries: number;
    /** Largest uncompressed size of one OOXML part. */
    maxPartBytes: number;
    /** Largest uncompressed:compressed ratio tolerated for one OOXML part. */
    maxCompressionRatio: number;
    /** Deepest nesting a structured format may use before it is refused. */
    maxDepth: number;
}
export declare const DEFAULT_DECODER_BUDGET: DecoderBudget;
export interface DocumentDecoder {
    id: string;
    version: string;
    format: DocumentFormat;
    /** Lowercased extensions this decoder claims, including the leading dot. */
    extensions: readonly string[];
    /**
     * Lowercased whole filenames this decoder claims.
     *
     * `Makefile` and `Dockerfile` carry no extension to dispatch on and are
     * ordinary text. Without this they would be eligible for decoding and claimed
     * by nobody, which is a coverage gap that looks like a decoder failure.
     */
    filenames?: readonly string[];
    decode(input: DecodeInput): DecodeOutcome;
}
/**
 * Identity of a normalized document.
 *
 * Bound to the exact bytes and to the decoder that read them, and to nothing
 * else. Two artifacts holding identical bytes produce one normalized document
 * identity, which is what lets the cache serve one to both; a decoder revision
 * produces a different one, which is what stops last release's reading being
 * presented as this release's.
 */
export declare function normalizedDocumentId(input: {
    contentHash: string;
    decoderId: string;
    decoderVersion: string;
}): string;
/** Identity of one block within a document. */
export declare function blockId(normalizedDocumentIdValue: string, ordinal: number): string;
/**
 * Collects blocks while holding the budget, so no decoder has to remember to.
 *
 * Truncation is recorded rather than silent: a document that hit a ceiling says
 * so in its diagnostics, and coverage can tell a short document from a curtailed
 * one.
 */
export declare class BlockBuilder {
    private readonly documentId;
    private readonly budget;
    private readonly blocks;
    private readonly tables;
    private readonly links;
    private readonly diagnostics;
    private textBytes;
    private truncated;
    private ordinal;
    constructor(documentId: string, budget: DecoderBudget);
    /** True once a ceiling has been reached and further content is being dropped. */
    get isFull(): boolean;
    add(kind: BlockKind, text: string, locator: BlockLocator): void;
    addTable(rows: string[][], locator: BlockLocator): void;
    addLink(href: string, text: string, locator: BlockLocator): void;
    note(diagnostic: DecoderDiagnostic): void;
    private markTruncated;
    finish(): Pick<NormalizedDocument, "blocks" | "tables" | "links" | "diagnostics">;
}
/** Assemble a decoded document from a builder's contents. */
export declare function buildNormalizedDocument(input: {
    decoder: Pick<DocumentDecoder, "id" | "version" | "format">;
    decodeInput: DecodeInput;
    documentId: string;
    metadata: Record<string, string>;
    builder: BlockBuilder;
}): NormalizedDocument;
/**
 * The decoders available, keyed by the extensions they claim.
 *
 * One decoder per extension. Two decoders competing for `.xml` would make which
 * one ran a function of registration order, and the normalized document identity
 * carries the decoder id — so the corpus identity would silently depend on
 * module load order.
 */
export declare class DecoderRegistry {
    private readonly byExtension;
    private readonly byFilename;
    private readonly decoders;
    register(decoder: DocumentDecoder): void;
    /** The decoder that claims this path, or undefined when none does. */
    forPath(sourcePath: string): DocumentDecoder | undefined;
    /** Every registered decoder, ordered by id so a profile is reproducible. */
    all(): DocumentDecoder[];
    /** Every claimed extension, in code-point order. */
    extensions(): string[];
    /** Every claimed whole filename, in code-point order. */
    filenames(): string[];
    /** `id@version` for every decoder: the analysis-identity contribution. */
    profile(): string[];
}
