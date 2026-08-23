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
import { compareCodePoints } from "../ordering";
import { stableId } from "../repository_model";

/** Every document format this release can turn into blocks. */
export const DOCUMENT_FORMATS = [
  "text",
  "markdown",
  "csv",
  "html",
  "ipynb",
  "pdf",
  "docx",
  "pptx",
  "xlsx",
] as const;

export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/**
 * What a block is, semantically.
 *
 * Deliberately small and closed. A richer vocabulary would let each decoder
 * invent its own categories, and the work-signal extractors downstream would
 * then have to know which decoder produced a block in order to read it.
 */
export const BLOCK_KINDS = [
  "title",
  "heading",
  "paragraph",
  "list_item",
  "code",
  "table",
  "note",
  "cell",
] as const;

export type BlockKind = (typeof BLOCK_KINDS)[number];

/**
 * Where a block came from, in the coordinate system its own format has.
 *
 * A slide has a slide number and a shape index. A worksheet has a sheet and a
 * cell reference. A PDF has a page and a block index within it. None of those is
 * a line number, and none of them is interchangeable with another.
 */
export type BlockLocator =
  | { kind: "line_span"; line_start: number; line_end: number }
  | { kind: "notebook_cell"; cell_index: number; cell_type: string; line_start: number; line_end: number }
  | { kind: "pdf_page_block"; page_number: number; block_index: number }
  | { kind: "docx_block"; block_index: number; part: string }
  | { kind: "pptx_shape"; slide_number: number; shape_index: number; part: string }
  | { kind: "spreadsheet_cell"; sheet: string; cell_or_range: string }
  | { kind: "csv_row"; row_number: number; column?: string }
  | { kind: "html_node"; node_path: string; node_index: number };

/** The locator kinds, exposed so a consumer can assert it handles them all. */
export const LOCATOR_KINDS = [
  "line_span",
  "notebook_cell",
  "pdf_page_block",
  "docx_block",
  "pptx_shape",
  "spreadsheet_cell",
  "csv_row",
  "html_node",
] as const;

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
export const DECODER_DIAGNOSTIC_CODES = [
  "decoder.encrypted",
  "decoder.ocr_required",
  "decoder.unsupported_feature",
  "decoder.malformed",
  "decoder.budget_exceeded",
  "decoder.external_reference_not_followed",
  "decoder.macro_present_not_executed",
  "decoder.truncated",
] as const;

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

export const NORMALIZED_DOCUMENT_SCHEMA = "l9.normalized-document/v1";

/**
 * What a decoder returns.
 *
 * `decoded` is the honest half of the contract. A decoder that cannot read its
 * input says so with a reason, and the caller records a coverage gap of that
 * exact kind rather than an empty document.
 */
export type DecodeOutcome =
  | { decoded: true; document: NormalizedDocument }
  | { decoded: false; reason: DecoderDiagnosticCode; message: string; diagnostics: DecoderDiagnostic[] };

export interface DecodeInput {
  artifactId: string;
  /** `sha256:`-prefixed hash of the exact source bytes. */
  contentHash: string;
  /** Root-relative path, used for extension dispatch and never as identity. */
  sourcePath: string;
  /** Absolute path to the bytes. Staged copies are fine; the source is not written. */
  absolutePath: string;
  /**
   * The file's bytes, when the caller already read them.
   *
   * Supplied by the corpus scan, which reads whole-file formats asynchronously so
   * several reads can be in flight at once — the concurrency
   * `max_parallel_decoders` exists to bound. A decoder that consumes whole bytes
   * must prefer this over reading the path again: doing otherwise reads every
   * document twice and puts the read back on the synchronous path, where the
   * bound has nothing to bound.
   *
   * Absent for container formats, whose readers stream parts out of the file by
   * offset rather than taking the whole thing into memory, and absent when a
   * decoder is called directly rather than from a scan.
   */
  bytes?: Buffer;
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

export const DEFAULT_DECODER_BUDGET: DecoderBudget = {
  maxSourceBytes: 64 * 1024 * 1024,
  maxTextBytes: 8 * 1024 * 1024,
  maxBlocks: 50_000,
  maxContainerEntries: 4096,
  maxPartBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxDepth: 64,
};

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
export function normalizedDocumentId(input: {
  contentHash: string;
  decoderId: string;
  decoderVersion: string;
}): string {
  return stableId("normdoc", {
    content_hash: input.contentHash,
    decoder_id: input.decoderId,
    decoder_version: input.decoderVersion,
  });
}

/** Identity of one block within a document. */
export function blockId(normalizedDocumentIdValue: string, ordinal: number): string {
  return stableId("block", {
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
export class BlockBuilder {
  private readonly blocks: DocumentBlock[] = [];
  private readonly tables: DocumentTable[] = [];
  private readonly links: DocumentLink[] = [];
  private readonly diagnostics: DecoderDiagnostic[] = [];
  private textBytes = 0;
  private truncated = false;
  private ordinal = 0;

  constructor(
    private readonly documentId: string,
    private readonly budget: DecoderBudget,
  ) {}

  /** True once a ceiling has been reached and further content is being dropped. */
  get isFull(): boolean {
    return this.truncated;
  }

  add(kind: BlockKind, text: string, locator: BlockLocator): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (this.truncated) return;
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

  addTable(rows: string[][], locator: BlockLocator): void {
    if (this.truncated) return;
    const cleaned = rows
      .map((row) => row.map((cell) => cell.trim()))
      .filter((row) => row.some((cell) => cell.length > 0));
    if (cleaned.length === 0) return;
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

  addLink(href: string, text: string, locator: BlockLocator): void {
    if (this.truncated) return;
    if (href.trim().length === 0) return;
    if (this.links.length >= this.budget.maxBlocks) return;
    this.links.push({ href: href.trim(), text: text.trim(), locator });
  }

  note(diagnostic: DecoderDiagnostic): void {
    this.diagnostics.push(diagnostic);
  }

  private markTruncated(message: string): void {
    this.truncated = true;
    this.diagnostics.push({
      code: "decoder.truncated",
      severity: "warning",
      message: `document was truncated: ${message}`,
    });
  }

  finish(): Pick<NormalizedDocument, "blocks" | "tables" | "links" | "diagnostics"> {
    return {
      blocks: this.blocks,
      tables: this.tables,
      links: this.links,
      diagnostics: [...this.diagnostics].sort(
        (a, b) => compareCodePoints(a.code, b.code) || compareCodePoints(a.message, b.message),
      ),
    };
  }
}

/** Assemble a decoded document from a builder's contents. */
export function buildNormalizedDocument(input: {
  decoder: Pick<DocumentDecoder, "id" | "version" | "format">;
  decodeInput: DecodeInput;
  documentId: string;
  metadata: Record<string, string>;
  builder: BlockBuilder;
}): NormalizedDocument {
  const { blocks, tables, links, diagnostics } = input.builder.finish();
  return {
    schema: NORMALIZED_DOCUMENT_SCHEMA,
    normalized_document_id: input.documentId,
    artifact_id: input.decodeInput.artifactId,
    source_content_hash: input.decodeInput.contentHash,
    format: input.decoder.format,
    decoder_id: input.decoder.id,
    decoder_version: input.decoder.version,
    metadata: Object.fromEntries(
      Object.entries(input.metadata)
        .filter(([, value]) => value.trim().length > 0)
        .sort(([a], [b]) => compareCodePoints(a, b)),
    ),
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
export class DecoderRegistry {
  private readonly byExtension = new Map<string, DocumentDecoder>();
  private readonly byFilename = new Map<string, DocumentDecoder>();
  private readonly decoders: DocumentDecoder[] = [];

  register(decoder: DocumentDecoder): void {
    const claim = (map: Map<string, DocumentDecoder>, key: string, what: string): void => {
      const existing = map.get(key);
      if (existing !== undefined && existing.id !== decoder.id) {
        throw new Error(
          `decoder-registry: ${what} '${key}' is claimed by both '${existing.id}' and '${decoder.id}'`,
        );
      }
      map.set(key, decoder);
    };
    for (const extension of decoder.extensions) claim(this.byExtension, extension, "extension");
    for (const filename of decoder.filenames ?? []) claim(this.byFilename, filename, "filename");
    this.decoders.push(decoder);
  }

  /** The decoder that claims this path, or undefined when none does. */
  forPath(sourcePath: string): DocumentDecoder | undefined {
    const basename = sourcePath.slice(sourcePath.lastIndexOf("/") + 1).toLowerCase();
    const named = this.byFilename.get(basename);
    if (named !== undefined) return named;
    const dot = basename.lastIndexOf(".");
    if (dot <= 0) return undefined;
    return this.byExtension.get(basename.slice(dot));
  }

  /** Every registered decoder, ordered by id so a profile is reproducible. */
  all(): DocumentDecoder[] {
    return [...this.decoders].sort((a, b) => compareCodePoints(a.id, b.id));
  }

  /** Every claimed extension, in code-point order. */
  extensions(): string[] {
    return [...this.byExtension.keys()].sort(compareCodePoints);
  }

  /** Every claimed whole filename, in code-point order. */
  filenames(): string[] {
    return [...this.byFilename.keys()].sort(compareCodePoints);
  }

  /** `id@version` for every decoder: the analysis-identity contribution. */
  profile(): string[] {
    return this.all().map((decoder) => `${decoder.id}@${decoder.version}`);
  }
}
