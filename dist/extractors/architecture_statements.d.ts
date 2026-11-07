import type { BlockLocator } from "../documents/decoder";
import type { DocumentBlockView } from "./document_blocks";
/** Identity of this reader. Bumped when the vocabulary or the grammar changes. */
export declare const ARCHITECTURE_STATEMENT_EXTRACTOR_ID = "architecture-statements/v1";
/**
 * 1.1.0 (coverage closure): a heading's leading section number and trailing
 * qualifier are not part of its label; a bold or numbered bare label on a line
 * of its own opens a section like a heading; the leading frontmatter fences of a
 * text file are read as `frontmatter_field` declarations; the lines that follow a
 * labelled field inside its block are its continuation, not separate members.
 * Statement identity does not include this version, so a statement these rules
 * read the same way keeps its evidence id.
 */
export declare const ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION = "1.1.0";
/** The five statement classes, in code-point order. Closed. */
export declare const ARCHITECTURE_STATEMENT_CLASSES: readonly ["assumption", "constraint", "decision_statement", "intent", "open_question"];
export type ArchitectureStatementClass = (typeof ARCHITECTURE_STATEMENT_CLASSES)[number];
/**
 * Which written label names which class.
 *
 * Keys are the normalized label — emphasis removed, lowercased, as
 * `readLabelledLine` returns it and as a heading's text is normalized below.
 * The table is the whole vocabulary: a label not in it is not a statement of
 * any class, however suggestive. `Questions` alone is deliberately absent (a FAQ
 * heading is not a list of unresolved questions), and so are `Goal of this
 * section` and every other phrase that merely contains a vocabulary word.
 */
export declare const ARCHITECTURE_LABEL_VOCABULARY: Readonly<Record<string, ArchitectureStatementClass>>;
/** How a statement was recognized. Recorded on every statement. */
export type ArchitectureRecognitionForm = "field_label" | "label_list" | "section_heading" | "frontmatter_field";
/**
 * Longest statement text kept verbatim. The excerpt is bounded separately by
 * `MAX_EXCERPT_LENGTH`; the declared text may be a whole paragraph and is given
 * more room, but a document cannot turn the evidence file into a copy of itself.
 */
export declare const MAX_STATEMENT_TEXT_LENGTH = 1024;
/** Coverage diagnostics one document may raise before the rest are summarized. */
export declare const MAX_ARCHITECTURE_DIAGNOSTICS_PER_DOCUMENT = 8;
/** One recognized statement, before identity and evidence plumbing is attached. */
export interface ArchitectureStatementDraft {
    statement_class: ArchitectureStatementClass;
    /** The statement as the document wrote it, normalized as a quotation and bounded. */
    declared_text: string;
    /** True when `declared_text` was cut at `MAX_STATEMENT_TEXT_LENGTH`. */
    declared_text_truncated: boolean;
    /** The unit of text the statement was read from, bounded. */
    bounded_excerpt: string;
    recognition: {
        form: ArchitectureRecognitionForm;
        label: string;
    };
    block: DocumentBlockView;
    /**
     * Which line of the block's text the statement starts on (0-based), or null
     * when the statement is the whole block. Stated separately from the locator
     * because most locators have no finer coordinate than the block, and a unit
     * offset is checkable against the block's text wherever it came from.
     */
    unit_index: number | null;
    /** How many of the block's lines the statement spans, from `unit_index`. */
    unit_count: number;
}
export interface ArchitectureCoverageDiagnostic {
    code: string;
    severity: "info" | "warning";
    message: string;
    block_id: string;
}
export interface ArchitectureStatementReading {
    statements: ArchitectureStatementDraft[];
    diagnostics: ArchitectureCoverageDiagnostic[];
    /** Diagnostics raised beyond the per-document bound, so the count is still stated. */
    diagnostics_omitted: number;
}
/** The class a heading names, or null when the heading is not in the vocabulary. */
export declare function architectureHeadingClass(text: string): ArchitectureStatementClass | null;
/**
 * A line that is a heading written without `#`: a bare vocabulary label wrapped
 * in emphasis (`**Constraints**`) or carrying a section number (`2.1 Open
 * Questions`), with nothing else on the line but an optional trailing colon.
 *
 * A plain `Constraints:` is deliberately not one: that shape has always opened a
 * list of the items that follow it (`label_list`), and reading it as a section
 * would change what it means and which statements it owns.
 */
export declare function architecturePseudoHeadingLabel(line: string): string | null;
/** A labelled line whose label is in the vocabulary, with its class and value. */
export declare function architectureLabelOf(line: string): {
    label: string;
    statementClass: ArchitectureStatementClass;
    value: string;
} | null;
/**
 * Read every architectural statement a document's blocks explicitly declare.
 *
 * Deterministic over the block sequence; never throws on malformed content; never
 * reads a file. Statements are returned in reading order, so a caller that wants
 * a total order sorts them on the identity it attaches.
 */
export declare function readArchitectureStatements(blocks: readonly DocumentBlockView[]): ArchitectureStatementReading;
/**
 * The coordinate a statement cites.
 *
 * A `line_span` block maps its text lines onto source lines one to one — the
 * text decoder joins the lines of a paragraph with `\n` and starts the span at
 * the first of them — so a statement starting on unit *k* of the block and
 * spanning *n* units cites lines `line_start + k` to `line_start + k + n - 1`,
 * never past the block's own end. Every other locator kind has no coordinate
 * finer than the block, and the block's own locator is cited verbatim; the unit
 * offset and count are carried beside it rather than converted into a line
 * number the format does not have.
 */
export declare function architectureStatementLocator(block: DocumentBlockView, unitIndex: number | null, unitCount?: number): BlockLocator;
/**
 * The reader's identity, for the profile hash.
 *
 * Everything that changes what this reader recognizes is in here: the vocabulary,
 * the forms, the block kinds it opens, the bounds. A caller hashing it binds the
 * rules a run applied, which is what makes two runs comparable.
 */
export declare function architectureStatementRules(): Record<string, unknown>;
