import { AssertionDraft, Extractor } from "../interpretation";
/**
 * A recognized claim, before anything has been decided about where it came from.
 *
 * Every rule in this module recognizes a claim in a *unit of text* — a line of
 * Markdown, a paragraph of a Word document, a shape on a slide, a spreadsheet
 * cell. What differs between those is the coordinate the evidence cites, not the
 * rule that read it: `Status: blocked` means the same thing in all four.
 *
 * So recognition returns this, carrying no position at all, and the two callers
 * attach the coordinate their own source actually has. A line-oriented file gets
 * a line span; a decoded document gets the block id and structured locator of the
 * block the text sat in. Neither can borrow the other's coordinate system, which
 * is what stops a Word document from being given line numbers it does not have.
 */
export interface SignalReading {
    predicate: string;
    object: string;
    /** The unit of text the claim was read from, quoted verbatim. */
    excerpt: string;
    evidenceClass: AssertionDraft["evidenceClass"];
    confidence: AssertionDraft["confidence"];
}
/**
 * What a document says it is called and how it is organized.
 *
 * Titles are emitted from every form the document uses, even when they disagree:
 * a frontmatter `title` and an `# H1` that differ is a fact about the document,
 * and picking a winner here would hide it.
 */
export declare const documentStructureExtractor: Extractor;
/**
 * Read one unit of text with the whole vocabulary, in precedence order.
 *
 * `admonitionsAllowed` is the caller's answer to "is this near the top of the
 * document", which is the only positional question any of these rules asks.
 * `listMarkerImplied` is its answer to "did the source say this was a list item
 * some way other than by writing a bullet".
 *
 * Exported because the block-driven reader in `./document_blocks` must apply
 * exactly these rules to a paragraph of a Word document or a shape on a slide. A
 * second implementation of "what is a status declaration" would eventually
 * disagree with this one, and a corpus would then report a `.docx` plan and the
 * `.md` copy of it beside it as saying different things.
 */
export declare function readTextUnit(line: string, options: {
    admonitionsAllowed: boolean;
    listMarkerImplied?: boolean;
}): SignalReading | null;
/**
 * Status and kind markers a declared title carries.
 *
 * Exported for the block reader, which meets titles as `title` blocks rather
 * than as `# ` lines but must read the same markers out of them.
 */
export declare function readTitleMarkers(text: string, excerpt: string): SignalReading[];
/** True for a heading that opens an explicit milestone list. */
export declare function isMilestoneSectionHeading(text: string): boolean;
/** Normalize a fragment of document text for use as an assertion object. */
export declare function documentText(value: string): string;
/** How far into a document a bare status admonition still counts as leading. */
export declare const LEADING_ADMONITION_UNITS = 10;
/**
 * Explicit work state: status, kind, tasks, milestones, and declared relations.
 *
 * Every rule here recognizes a form the document chose deliberately. Nothing is
 * read from a path, a filename, a modification time, or the absence of a signal.
 */
export declare const workIntelligenceExtractor: Extractor;
/** The vocabularies this profile recognizes, for documentation and reporting. */
export declare const WORK_STATUS_VOCABULARY: readonly string[];
export declare const WORK_KIND_VOCABULARY: readonly string[];
/** Every predicate the work-intelligence profile can emit, in code-point order. */
export declare const WORK_PREDICATES: readonly string[];
