"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ARCHITECTURE_DIAGNOSTICS_PER_DOCUMENT = exports.MAX_STATEMENT_TEXT_LENGTH = exports.ARCHITECTURE_LABEL_VOCABULARY = exports.ARCHITECTURE_STATEMENT_CLASSES = exports.ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION = exports.ARCHITECTURE_STATEMENT_EXTRACTOR_ID = void 0;
exports.architectureHeadingClass = architectureHeadingClass;
exports.architectureLabelOf = architectureLabelOf;
exports.readArchitectureStatements = readArchitectureStatements;
exports.architectureStatementLocator = architectureStatementLocator;
exports.architectureStatementRules = architectureStatementRules;
const interpretation_1 = require("../interpretation");
const ordering_1 = require("../ordering");
const work_intelligence_1 = require("./work_intelligence");
/** Identity of this reader. Bumped when the vocabulary or the grammar changes. */
exports.ARCHITECTURE_STATEMENT_EXTRACTOR_ID = "architecture-statements/v1";
exports.ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION = "1.0.0";
/** The five statement classes, in code-point order. Closed. */
exports.ARCHITECTURE_STATEMENT_CLASSES = [
    "assumption",
    "constraint",
    "decision_statement",
    "intent",
    "open_question",
];
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
exports.ARCHITECTURE_LABEL_VOCABULARY = {
    objective: "intent",
    objectives: "intent",
    goal: "intent",
    goals: "intent",
    intent: "intent",
    constraint: "constraint",
    constraints: "constraint",
    invariant: "constraint",
    invariants: "constraint",
    assumption: "assumption",
    assumptions: "assumption",
    "open question": "open_question",
    "open questions": "open_question",
    unresolved: "open_question",
    "unresolved question": "open_question",
    "unresolved questions": "open_question",
    decision: "decision_statement",
    decisions: "decision_statement",
};
/**
 * Longest statement text kept verbatim. The excerpt is bounded separately by
 * `MAX_EXCERPT_LENGTH`; the declared text may be a whole paragraph and is given
 * more room, but a document cannot turn the evidence file into a copy of itself.
 */
exports.MAX_STATEMENT_TEXT_LENGTH = 1024;
/** Coverage diagnostics one document may raise before the rest are summarized. */
exports.MAX_ARCHITECTURE_DIAGNOSTICS_PER_DOCUMENT = 8;
/**
 * Block kinds whose text is read for statements.
 *
 * `code` is never read, for the reason the work readers give: an example in a
 * fence is not a declaration. `table` is not read either: a table's text is a
 * row rendering, and a row that happens to begin `Decision | ...` is a column
 * header rather than a statement. A table under a labelled section is reported
 * as unsupported instead of guessed at.
 */
const READABLE_BLOCK_KINDS = new Set(["paragraph", "list_item", "note", "cell"]);
const TITULAR_BLOCK_KINDS = new Set(["title", "heading"]);
/** A unit of text, as the block-signal reader splits one: CRLF, LF or lone CR. */
function unitsOf(text) {
    return text.split(/\r\n|\r|\n/);
}
/** A heading's text as a vocabulary key: quoted, lowercased, trailing colon dropped. */
function headingLabel(text) {
    return (0, work_intelligence_1.documentText)(text).toLowerCase().replace(/\s*:\s*$/, "").trim();
}
/** The class a heading names, or null when the heading is not in the vocabulary. */
function architectureHeadingClass(text) {
    const firstLine = unitsOf(text).find((line) => line.trim().length > 0);
    if (firstLine === undefined)
        return null;
    return exports.ARCHITECTURE_LABEL_VOCABULARY[headingLabel(firstLine)] ?? null;
}
/** A labelled line whose label is in the vocabulary, with its class and value. */
function architectureLabelOf(line) {
    const labelled = (0, work_intelligence_1.readLabelledLine)(line);
    if (labelled === null)
        return null;
    const statementClass = exports.ARCHITECTURE_LABEL_VOCABULARY[labelled.label];
    if (statementClass === undefined)
        return null;
    return { label: labelled.label, statementClass, value: labelled.value };
}
/**
 * True for a unit the work-intelligence vocabulary already claims.
 *
 * `Status: blocked`, `- [ ] ship it`, `Depends on: core` under a `## Constraints`
 * heading are declarations of work state, read by the work extractors and cited
 * there. Reading them again as constraints would file one line under two
 * predicates. The two vocabularies are disjoint, so the question is asked only
 * for a unit the architecture vocabulary did not claim.
 */
function isWorkSignalUnit(line) {
    return (0, work_intelligence_1.readTextUnit)(line, { admonitionsAllowed: false, listMarkerImplied: true }) !== null;
}
/**
 * True for a unit shaped like a Markdown table row.
 *
 * The text decoder has no table construct for Markdown, so a pipe table arrives
 * as a paragraph whose every line opens with `|`. Its first row is a header and
 * its rows are cells; neither is a sentence the document declared, and under a
 * `## Decisions` heading the whole block would otherwise be quoted as one
 * decision. Tables are reported as unsupported instead, in either format.
 */
function isTableRow(line) {
    return /^\s*\|/.test(line);
}
/** True when every content line of a block is a table row. */
function isTableShaped(units) {
    const content = units.filter((unit) => unit.trim().length > 0);
    return content.length > 0 && content.every(isTableRow);
}
/**
 * True for a unit of the `Label: value` shape with a label this reader does not
 * know.
 *
 * `Owner: mel` or `Type: specification` under a `## Constraints` heading is a
 * declaration under its own label, and what that label means is not something
 * this reader can decide. Skipped, and counted, rather than quoted as a
 * constraint it was never written to be. The architecture and work vocabularies
 * are tested before this question is asked, so neither is affected by it.
 */
function isForeignLabelledUnit(line) {
    return (0, work_intelligence_1.readLabelledLine)(line) !== null;
}
/** Cut a quotation at the statement bound, saying so. */
function boundStatementText(value) {
    if (value.length <= exports.MAX_STATEMENT_TEXT_LENGTH)
        return { text: value, truncated: false };
    return { text: `${value.slice(0, exports.MAX_STATEMENT_TEXT_LENGTH - 1)}…`, truncated: true };
}
/** The recognizer's working state while it walks one document's blocks. */
class StatementReader {
    constructor(blocks) {
        this.blocks = blocks;
        this.statements = [];
        this.raised = [];
        /** An open `## Constraints`-style section, until the next titular or code block. */
        this.section = null;
        /** An open `Constraints:` label waiting for the list items that follow it. */
        this.pendingList = null;
    }
    read() {
        for (const block of this.blocks)
            this.readBlock(block);
        this.closePendingList();
        this.closeSection();
        const bounded = this.raised.slice(0, exports.MAX_ARCHITECTURE_DIAGNOSTICS_PER_DOCUMENT);
        return {
            statements: this.statements,
            diagnostics: bounded,
            diagnostics_omitted: this.raised.length - bounded.length,
        };
    }
    diagnostic(code, severity, message, block) {
        this.raised.push({ code, severity, message, block_id: block.block_id });
    }
    emit(statementClass, rawText, excerpt, form, label, block, unitIndex) {
        const quoted = (0, work_intelligence_1.documentText)(rawText);
        if (quoted.length === 0)
            return false;
        const boundedExcerpt = (0, interpretation_1.boundExcerpt)(excerpt);
        // A refusal rather than a redaction, as every other reader in this package
        // does it: a redacted excerpt is no longer evidence of anything.
        if ((0, interpretation_1.looksSecret)(boundedExcerpt) || (0, interpretation_1.looksSecret)(quoted)) {
            this.diagnostic("architecture_evidence.secret_value_suppressed", "warning", `a ${statementClass} declaration was dropped because its text resembled a credential`, block);
            return false;
        }
        const { text, truncated } = boundStatementText(quoted);
        if (truncated) {
            this.diagnostic("architecture_evidence.statement_truncated", "info", `a ${statementClass} declaration longer than ${exports.MAX_STATEMENT_TEXT_LENGTH} characters was cut; the bounded excerpt and the coordinate still identify it`, block);
        }
        this.statements.push({
            statement_class: statementClass,
            declared_text: text,
            declared_text_truncated: truncated,
            bounded_excerpt: boundedExcerpt,
            recognition: { form, label },
            block,
            unit_index: unitIndex,
        });
        return true;
    }
    closePendingList() {
        const pending = this.pendingList;
        if (pending === null)
            return;
        this.pendingList = null;
        if (pending.members === 0) {
            this.diagnostic("architecture_evidence.empty_declaration", "warning", `'${pending.label}:' declares a ${pending.statementClass} list and nothing follows it that this reader can attribute to it`, pending.block);
        }
    }
    closeSection() {
        const section = this.section;
        if (section === null)
            return;
        this.section = null;
        if (section.members === 0) {
            this.diagnostic("architecture_evidence.section_without_items", "warning", `the '${section.label}' section declares ${section.statementClass} statements and holds no item or paragraph this reader can attribute to it`, section.block);
        }
    }
    readBlock(block) {
        if (TITULAR_BLOCK_KINDS.has(block.kind)) {
            // Any heading ends what came before it, whether or not it opens a section.
            this.closePendingList();
            this.closeSection();
            const statementClass = architectureHeadingClass(block.text);
            if (statementClass !== null) {
                this.section = { statementClass, label: headingLabel(block.text), members: 0, block };
            }
            return;
        }
        if (block.kind === "code") {
            this.closePendingList();
            this.closeSection();
            return;
        }
        const units = unitsOf(block.text);
        if (!READABLE_BLOCK_KINDS.has(block.kind) || isTableShaped(units)) {
            // A table (or any kind this reader does not open) under a labelled section
            // is a construct outside the grammar: reported, never interpreted.
            if (this.pendingList !== null || this.section !== null) {
                const owner = this.pendingList ?? this.section;
                const shape = isTableShaped(units) ? "table-shaped" : block.kind;
                this.diagnostic("architecture_evidence.unsupported_member_block", "info", `a ${shape} block under the '${owner?.label}' ${owner?.statementClass} declaration was not read; this reader attributes list items and paragraphs only`, block);
            }
            this.closePendingList();
            return;
        }
        const labelled = units.map((unit) => architectureLabelOf(unit));
        if (labelled.some((hit) => hit !== null)) {
            this.closePendingList();
            this.readLabelledBlock(block, units, labelled);
            return;
        }
        // A pending `Label:` list takes the list items that follow it and ends at the
        // first block that is not one — the shape `milestoneSectionBullets` reads.
        if (this.pendingList !== null) {
            if (block.kind === "list_item") {
                this.readMembers(block, units, this.pendingList.statementClass, "label_list", this.pendingList.label, this.pendingList);
                return;
            }
            this.closePendingList();
        }
        if (this.section !== null) {
            const section = this.section;
            // A whole paragraph under `## Constraints` is one constraint; a list item is
            // one; each is quoted as the document wrote it. A unit the work vocabulary
            // claims is skipped, so `Status: blocked` under a section is not a constraint.
            if (block.kind === "list_item" || block.kind === "cell") {
                this.readMembers(block, units, section.statementClass, "section_heading", section.label, section);
                return;
            }
            const kept = units.filter((unit) => unit.trim().length > 0 && !this.skipsMember(unit, section, block));
            if (kept.length > 0) {
                if (this.emit(section.statementClass, kept.join("\n"), block.text, "section_heading", section.label, block, null)) {
                    section.members += 1;
                }
            }
        }
    }
    /**
     * True for a unit that is not attributed to the open declaration: one the work
     * vocabulary claims, or one declared under a label this reader does not know.
     * The second case is counted, so a reader of the manifest can see what a
     * section held that was not quoted.
     */
    skipsMember(unit, owner, block) {
        if (isWorkSignalUnit(unit))
            return true;
        if (!isForeignLabelledUnit(unit))
            return false;
        this.diagnostic("architecture_evidence.labelled_member_skipped", "info", `a 'label: value' line under the '${owner.label}' ${owner.statementClass} declaration carries a label this reader does not know and was not quoted as a statement`, block);
        return true;
    }
    /** Items read one unit at a time, each attributed to the open declaration. */
    readMembers(block, units, statementClass, form, label, owner) {
        for (const [index, unit] of units.entries()) {
            if (unit.trim().length === 0 || this.skipsMember(unit, { statementClass, label }, block))
                continue;
            if (this.emit(statementClass, unit, unit, form, label, block, index))
                owner.members += 1;
        }
    }
    /**
     * A block holding at least one vocabulary label, read unit by unit.
     *
     * `Objective: ship it` is a statement on its own line. `Constraints:` with
     * nothing after the colon opens a list: the units after it in the same block
     * belong to it, and if there are none, the list items that follow the block
     * do. A unit that is neither — body text in a block that also carries a label
     * — belongs to the open heading section if there is one, and to nothing
     * otherwise: a label on line three does not reach back to claim lines one and
     * two.
     */
    readLabelledBlock(block, units, labelled) {
        let open = null;
        for (const [index, unit] of units.entries()) {
            const hit = labelled[index];
            if (hit !== null) {
                if (open !== null && open.members === 0) {
                    this.diagnostic("architecture_evidence.empty_declaration", "warning", `'${open.label}:' declares a ${open.statementClass} list and nothing follows it that this reader can attribute to it`, block);
                }
                open = null;
                if (hit.value.length > 0) {
                    this.emit(hit.statementClass, hit.value, unit, "field_label", hit.label, block, index);
                }
                else {
                    open = { statementClass: hit.statementClass, label: hit.label, members: 0 };
                }
                continue;
            }
            if (unit.trim().length === 0)
                continue;
            if (open !== null) {
                if (this.skipsMember(unit, open, block))
                    continue;
                if (this.emit(open.statementClass, unit, unit, "label_list", open.label, block, index))
                    open.members += 1;
                continue;
            }
            if (this.section !== null) {
                if (this.skipsMember(unit, this.section, block))
                    continue;
                if (this.emit(this.section.statementClass, unit, unit, "section_heading", this.section.label, block, index)) {
                    this.section.members += 1;
                }
            }
        }
        if (open !== null && open.members === 0) {
            // Nothing in this block followed the label; the list items after it may.
            this.pendingList = { statementClass: open.statementClass, label: open.label, members: 0, block };
        }
    }
}
/**
 * Read every architectural statement a document's blocks explicitly declare.
 *
 * Deterministic over the block sequence; never throws on malformed content; never
 * reads a file. Statements are returned in reading order, so a caller that wants
 * a total order sorts them on the identity it attaches.
 */
function readArchitectureStatements(blocks) {
    return new StatementReader(blocks).read();
}
/**
 * The coordinate a statement cites.
 *
 * A `line_span` block maps its text lines onto source lines one to one — the
 * text decoder joins the lines of a paragraph with `\n` and starts the span at
 * the first of them — so a statement on unit *k* of the block is on line
 * `line_start + k`, and the locator says exactly that line. Every other locator
 * kind has no coordinate finer than the block, and the block's own locator is
 * cited verbatim; the unit offset is carried beside it rather than converted
 * into a line number the format does not have.
 */
function architectureStatementLocator(block, unitIndex) {
    const locator = block.locator;
    if (locator.kind === "line_span" && unitIndex !== null) {
        const line = locator.line_start + unitIndex;
        if (line <= locator.line_end)
            return { kind: "line_span", line_start: line, line_end: line };
    }
    return locator;
}
/**
 * The reader's identity, for the profile hash.
 *
 * Everything that changes what this reader recognizes is in here: the vocabulary,
 * the forms, the block kinds it opens, the bounds. A caller hashing it binds the
 * rules a run applied, which is what makes two runs comparable.
 */
function architectureStatementRules() {
    return {
        extractor_id: exports.ARCHITECTURE_STATEMENT_EXTRACTOR_ID,
        extractor_version: exports.ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION,
        statement_classes: [...exports.ARCHITECTURE_STATEMENT_CLASSES],
        recognition_forms: ["field_label", "label_list", "section_heading"],
        vocabulary: Object.keys(exports.ARCHITECTURE_LABEL_VOCABULARY)
            .sort(ordering_1.compareCodePoints)
            .map((label) => [label, exports.ARCHITECTURE_LABEL_VOCABULARY[label]]),
        readable_block_kinds: [...READABLE_BLOCK_KINDS].sort(ordering_1.compareCodePoints),
        section_delimiters: ["code", "heading", "title"],
        work_vocabulary_excluded: true,
        foreign_labelled_members_excluded: true,
        table_shaped_blocks_excluded: true,
        max_statement_text_length: exports.MAX_STATEMENT_TEXT_LENGTH,
        max_excerpt_length: interpretation_1.MAX_EXCERPT_LENGTH,
        max_diagnostics_per_document: exports.MAX_ARCHITECTURE_DIAGNOSTICS_PER_DOCUMENT,
    };
}
//# sourceMappingURL=architecture_statements.js.map