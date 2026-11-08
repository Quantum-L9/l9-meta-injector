import type { BlockLocator } from "../documents/decoder";
import type { DocumentBlockView } from "./document_blocks";
/**
 * Identity of this reader. The version moves when the grammar changes; the id
 * moves only when the vocabulary or the record identity does, because the id is
 * hashed into every `evidence_id` and an unchanged statement must keep its id.
 *
 * 1.1.0: numbered and qualified section headings, setext headings, lazy and
 * soft-break continuation, YAML frontmatter scalars, thematic breaks, and the
 * `heading_not_recognized` diagnostic.
 */
export declare const ARCHITECTURE_STATEMENT_EXTRACTOR_ID = "architecture-statements/v1";
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
export type ArchitectureRecognitionForm = "field_label" | "label_list" | "section_heading";
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
     * Which line of the block's text the statement sits on (0-based), or null when
     * the statement is the whole block. Stated separately from the locator because
     * most locators have no finer coordinate than the block, and a unit offset is
     * checkable against the block's text wherever it came from.
     */
    unit_index: number | null;
    /**
     * The last line of the block's text the statement covers (0-based), when it
     * continues past `unit_index` inside the same block — a wrapped labelled value
     * or a block-scalar frontmatter value. Null when the statement is one unit.
     */
    unit_end_index: number | null;
    /**
     * Blocks after `block` that the statement continues into, in order: the lazy
     * continuation lines of a Markdown list item. Empty for a one-block statement.
     */
    continuation_blocks: DocumentBlockView[];
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
/**
 * A heading's text normalized under this reader's heading grammar: quoted,
 * lowercased, one section number and one parenthetical qualifier removed.
 * Exported so a selection over the same blocks reads `## 1. Status` the way this
 * reader reads `## 1. Constraints`; it says nothing about the vocabulary.
 */
export declare function architectureHeadingLabel(text: string): string;
/** The class a heading names, or null when the heading is not in the vocabulary. */
export declare function architectureHeadingClass(text: string): ArchitectureStatementClass | null;
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
 * the first of them — so a statement on unit *k* of the block is on line
 * `line_start + k`, and the locator says exactly that line; a statement that
 * continues to unit *m*, or into the next blocks, ends on the line it ends on.
 * Every other locator kind has no coordinate finer than the block, and the
 * block's own locator is cited verbatim; the unit offset is carried beside it
 * rather than converted into a line number the format does not have.
 */
export declare function architectureStatementLocator(block: DocumentBlockView, unitIndex: number | null, unitEndIndex?: number | null, continuationBlocks?: readonly DocumentBlockView[]): BlockLocator;
/**
 * The reader's identity, for the profile hash.
 *
 * Everything that changes what this reader recognizes is in here: the vocabulary,
 * the forms, the block kinds it opens, the bounds. A caller hashing it binds the
 * rules a run applied, which is what makes two runs comparable.
 */
export declare function architectureStatementRules(): Record<string, unknown>;
