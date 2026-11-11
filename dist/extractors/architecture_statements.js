"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ARCHITECTURE_DIAGNOSTICS_PER_DOCUMENT = exports.MAX_STATEMENT_TEXT_LENGTH = exports.ARCHITECTURE_LABEL_VOCABULARY = exports.ARCHITECTURE_STATEMENT_CLASSES = exports.ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION = exports.ARCHITECTURE_STATEMENT_EXTRACTOR_ID = void 0;
exports.architectureHeadingLabel = architectureHeadingLabel;
exports.architectureHeadingClass = architectureHeadingClass;
exports.architectureLabelOf = architectureLabelOf;
exports.readArchitectureStatements = readArchitectureStatements;
exports.architectureStatementLocator = architectureStatementLocator;
exports.architectureStatementRules = architectureStatementRules;
const interpretation_1 = require("../interpretation");
const ordering_1 = require("../ordering");
const work_intelligence_1 = require("./work_intelligence");
/**
 * Identity of this reader. The version moves when the grammar changes; the id
 * moves only when the vocabulary or the record identity does, because the id is
 * hashed into every `evidence_id` and an unchanged statement must keep its id.
 *
 * 1.1.0: numbered and qualified section headings, setext headings, lazy and
 * soft-break continuation, YAML frontmatter scalars, thematic breaks, and the
 * `heading_not_recognized` diagnostic.
 */
exports.ARCHITECTURE_STATEMENT_EXTRACTOR_ID = "architecture-statements/v1";
exports.ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION = "1.1.0";
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
const READABLE_BLOCK_KINDS = new Set([
    "paragraph",
    "list_item",
    "note",
    "cell",
]);
const TITULAR_BLOCK_KINDS = new Set(["title", "heading"]);
/** A unit of text, as the block-signal reader splits one: CRLF, LF or lone CR. */
function unitsOf(text) {
    return text.split(/\r\n|\r|\n/);
}
/**
 * A section number in front of a heading's label: `2.`, `2.1`, `3.4.1.`, `A.`, `b)`.
 * Decimal levels are bounded, and a letter prefix is one letter, so a heading
 * whose first word merely starts with a letter is never cut.
 */
const HEADING_NUMBER_PREFIX = /^(?:\d{1,3}(?:\.\d{1,3}){0,5}\.?|[a-z][.)])\s+/;
/** One trailing parenthetical qualifier: `(v2)`, `(draft)`, `(2026-11-07)`. */
const HEADING_QUALIFIER_SUFFIX = /\s*\([^()]{1,40}\)$/;
/** A setext underline: three or more of one marker is not required, one is (CommonMark). */
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
/** A CommonMark thematic break: three or more `-`, `*` or `_`, optionally spaced. */
const THEMATIC_BREAK = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
function withoutTrailingColon(value) {
    return value.replace(/\s*:\s*$/, "").trim();
}
/**
 * A heading's text as a vocabulary key.
 *
 * Quoted, lowercased, a trailing colon dropped; then one section number in front
 * and one parenthetical qualifier at the end, when present. What remains must be
 * a vocabulary key exactly — `Constraints and Assumptions` remains itself and is
 * not a key.
 */
function headingLabel(text) {
    let label = withoutTrailingColon((0, work_intelligence_1.documentText)(text).toLowerCase());
    label = label.replace(HEADING_NUMBER_PREFIX, "");
    label = withoutTrailingColon(label.replace(HEADING_QUALIFIER_SUFFIX, ""));
    return label;
}
/**
 * A heading's text normalized under this reader's heading grammar: quoted,
 * lowercased, one section number and one parenthetical qualifier removed.
 * Exported so a selection over the same blocks reads `## 1. Status` the way this
 * reader reads `## 1. Constraints`; it says nothing about the vocabulary.
 */
function architectureHeadingLabel(text) {
    const firstLine = unitsOf(text).find((line) => line.trim().length > 0);
    return firstLine === undefined ? "" : headingLabel(firstLine);
}
/** The class a heading names, or null when the heading is not in the vocabulary. */
function architectureHeadingClass(text) {
    const firstLine = unitsOf(text).find((line) => line.trim().length > 0);
    if (firstLine === undefined)
        return null;
    return exports.ARCHITECTURE_LABEL_VOCABULARY[headingLabel(firstLine)] ?? null;
}
/**
 * The vocabulary label a heading names inside a phrase the grammar refuses, or
 * null. Whole words only: `Goalkeeper` names nothing.
 */
function vocabularyWordInHeading(text) {
    const normalized = (0, work_intelligence_1.documentText)(text).toLowerCase();
    for (const label of Object.keys(exports.ARCHITECTURE_LABEL_VOCABULARY).sort(ordering_1.compareCodePoints)) {
        const at = normalized.indexOf(label);
        if (at < 0)
            continue;
        const before = at === 0 ? "" : normalized[at - 1];
        const after = normalized[at + label.length] ?? "";
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after))
            return label;
    }
    return null;
}
/**
 * True when position `at` of a line lies inside a CommonMark inline code span.
 *
 * A span opens at a run of N backticks and closes at the next run of exactly N
 * (``Decision:`` is one span, `a``b` another); a run with no closing run of the
 * same length is literal text, not a span.
 */
function insideCodeSpan(line, at) {
    const runEnd = (from) => {
        let end = from;
        while (end < line.length && line[end] === "`")
            end += 1;
        return end;
    };
    let index = 0;
    while (index < line.length && index <= at) {
        if (line[index] !== "`") {
            index += 1;
            continue;
        }
        const openEnd = runEnd(index);
        const length = openEnd - index;
        let close = -1;
        for (let scan = openEnd; scan < line.length;) {
            if (line[scan] !== "`") {
                scan += 1;
                continue;
            }
            const end = runEnd(scan);
            if (end - scan === length) {
                close = scan;
                break;
            }
            scan = end;
        }
        if (close < 0) {
            index = openEnd;
            continue;
        }
        if (at >= openEnd && at < close)
            return true;
        index = close + length;
    }
    return false;
}
/** A labelled line whose label is in the vocabulary, with its class and value. */
function architectureLabelOf(line) {
    const labelled = (0, work_intelligence_1.readLabelledLine)(line);
    if (labelled === null)
        return null;
    // `` `Decision:` — is read by … `` mentions a label inside an inline code span;
    // it declares nothing.
    if (insideCodeSpan(line, line.indexOf(":")))
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
/**
 * True for a unit that can only be running text: no label of any vocabulary, no
 * work signal, no table row, no thematic break. Only such a unit may continue a
 * statement across a soft line break; anything else keeps the meaning it had.
 */
function isPlainUnit(line) {
    return (line.trim().length > 0 &&
        !isTableRow(line) &&
        !THEMATIC_BREAK.test(line) &&
        !isWorkSignalUnit(line) &&
        !isForeignLabelledUnit(line));
}
/** The heading text of a setext heading block, or null when the block is not one. */
function setextHeadingText(block, units) {
    if (block.kind !== "paragraph" || block.locator.kind !== "line_span")
        return null;
    if (units.length < 2)
        return null;
    const underline = units[units.length - 1];
    if (!SETEXT_UNDERLINE.test(underline))
        return null;
    const content = units.slice(0, -1);
    if (content.some((unit) => unit.trim().length === 0 || isTableRow(unit)))
        return null;
    return content.map((unit) => unit.trim()).join(" ");
}
/** Cut a quotation at the statement bound, saying so. */
function boundStatementText(value) {
    if (value.length <= exports.MAX_STATEMENT_TEXT_LENGTH)
        return { text: value, truncated: false };
    return { text: `${value.slice(0, exports.MAX_STATEMENT_TEXT_LENGTH - 1)}…`, truncated: true };
}
/** A YAML quoted scalar, unquoted; any other value unchanged. */
function unquoteYamlScalar(value) {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1).replace(/''/g, "'");
    }
    return value;
}
/**
 * The document's YAML frontmatter, located over the decoded blocks.
 *
 * The same rule the work reader applies to raw lines (`findFrontmatter`): the
 * first line is `---`, and a `---` or `...` within the line bound closes it. Only
 * a `line_span` document has lines to ask about; every other format has no
 * frontmatter. An unclosed opener is not frontmatter.
 */
function findFrontmatterRegion(blocks) {
    const first = blocks[0];
    if (first === undefined || first.locator.kind !== "line_span" || first.locator.line_start !== 1)
        return null;
    if (unitsOf(first.text)[0]?.trim() !== work_intelligence_1.FRONTMATTER_OPEN_DELIMITER)
        return null;
    for (const block of blocks) {
        if (block.locator.kind !== "line_span")
            return null;
        const start = block.locator.line_start;
        for (const [index, unit] of unitsOf(block.text).entries()) {
            const line = start + index;
            if (line === 1)
                continue;
            // The work reader scans lines 2..FRONTMATTER_LINE_LIMIT (1-based) for the
            // closing delimiter; the bound is inclusive here too.
            if (line > work_intelligence_1.FRONTMATTER_LINE_LIMIT)
                return null;
            if (work_intelligence_1.FRONTMATTER_CLOSE_DELIMITERS.includes(unit.trim()))
                return { firstLine: 1, lastLine: line };
        }
    }
    return null;
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
        /**
         * The statement read from the Markdown list item just before this block, which
         * a lazy continuation paragraph on the very next line extends.
         */
        this.lastListItem = null;
        this.frontmatter = findFrontmatterRegion(blocks);
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
    emit(statementClass, rawText, excerpt, form, label, block, unitIndex, unitEndIndex = null) {
        const quoted = (0, work_intelligence_1.documentText)(rawText);
        if (quoted.length === 0)
            return null;
        const boundedExcerpt = (0, interpretation_1.boundExcerpt)(excerpt);
        // A refusal rather than a redaction, as every other reader in this package
        // does it: a redacted excerpt is no longer evidence of anything.
        if ((0, interpretation_1.looksSecret)(boundedExcerpt) || (0, interpretation_1.looksSecret)(quoted)) {
            this.diagnostic("architecture_evidence.secret_value_suppressed", "warning", `a ${statementClass} declaration was dropped because its text resembled a credential`, block);
            return null;
        }
        const { text, truncated } = boundStatementText(quoted);
        if (truncated)
            this.truncated(statementClass, block);
        const draft = {
            statement_class: statementClass,
            declared_text: text,
            declared_text_truncated: truncated,
            bounded_excerpt: boundedExcerpt,
            recognition: { form, label },
            block,
            unit_index: unitIndex,
            unit_end_index: unitEndIndex !== null && unitEndIndex !== unitIndex ? unitEndIndex : null,
            continuation_blocks: [],
        };
        this.statements.push(draft);
        return draft;
    }
    truncated(statementClass, block) {
        this.diagnostic("architecture_evidence.statement_truncated", "info", `a ${statementClass} declaration longer than ${exports.MAX_STATEMENT_TEXT_LENGTH} characters was cut; the bounded excerpt and the coordinate still identify it`, block);
    }
    /**
     * Extend an emitted statement by running text that continues it across a soft
     * line break. The quotation and the excerpt are recomputed from the raw text,
     * so they read as the document does; a continuation that makes the whole
     * resemble a credential withdraws the statement rather than keeping half of it.
     */
    extend(draft, raw, excerpt, block) {
        const quoted = (0, work_intelligence_1.documentText)(raw);
        const boundedExcerpt = (0, interpretation_1.boundExcerpt)(excerpt);
        if ((0, interpretation_1.looksSecret)(boundedExcerpt) || (0, interpretation_1.looksSecret)(quoted)) {
            const at = this.statements.indexOf(draft);
            if (at >= 0)
                this.statements.splice(at, 1);
            this.diagnostic("architecture_evidence.secret_value_suppressed", "warning", `a ${draft.statement_class} declaration was dropped because its continued text resembled a credential`, block);
            return false;
        }
        const { text, truncated } = boundStatementText(quoted);
        if (truncated && !draft.declared_text_truncated)
            this.truncated(draft.statement_class, block);
        draft.declared_text = text;
        draft.declared_text_truncated = truncated;
        draft.bounded_excerpt = boundedExcerpt;
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
    /** A heading, of any form: it ends what came before it and may open a section. */
    readHeading(text, block) {
        this.closePendingList();
        this.closeSection();
        const statementClass = architectureHeadingClass(text);
        if (statementClass !== null) {
            this.section = { statementClass, label: headingLabel(text), members: 0, block };
            return;
        }
        const named = vocabularyWordInHeading(text);
        if (named !== null) {
            this.diagnostic("architecture_evidence.heading_not_recognized", "info", `a heading names '${named}' inside a phrase this reader does not accept as a section label; nothing under it is attributed to a statement class`, block);
        }
    }
    /**
     * True when this block is the lazy continuation of the list item just read.
     *
     * CommonMark: a paragraph line directly after a list item, with no blank line
     * between them, continues that item's paragraph whether or not it is indented.
     * The decoder flushes a paragraph at every blank line, so the paragraph block
     * starting on the next line is exactly such a continuation. It is joined only
     * when every line is running text; a line carrying a label keeps the meaning it
     * has always had.
     */
    continuesListItem(block, units) {
        const item = this.lastListItem;
        if (item === null || block.kind !== "paragraph" || block.locator.kind !== "line_span")
            return false;
        if (block.locator.line_start !== item.lineEnd + 1)
            return false;
        if (units.some((unit) => !isPlainUnit(unit) || architectureLabelOf(unit) !== null))
            return false;
        if (setextHeadingText(block, units) !== null)
            return false;
        const raw = `${item.raw}\n${units.join("\n")}`;
        const excerpt = `${item.excerpt}\n${units.join("\n")}`;
        if (!this.extend(item.draft, raw, excerpt, block)) {
            this.lastListItem = null;
            return true;
        }
        item.draft.continuation_blocks.push(block);
        item.raw = raw;
        item.excerpt = excerpt;
        item.lineEnd = block.locator.line_end;
        return true;
    }
    /**
     * The units of a block as this reader reads them.
     *
     * Outside frontmatter, the units as written. Inside it, each `key: value` line
     * is read under the work reader's YAML scalar rules: a comment line and a
     * delimiter read as blank; a trailing comment is cut; a quoted scalar is
     * unquoted; a block scalar's indented lines become its value on the key's
     * unit, and read as blank themselves. A flow sequence is not read as a
     * statement and is reported.
     */
    readableUnits(block, units) {
        const region = this.frontmatter;
        const plain = units.map((text) => ({ text, endIndex: null }));
        if (region === null || block.locator.kind !== "line_span")
            return plain;
        const start = block.locator.line_start;
        if (start > region.lastLine)
            return plain;
        const out = [];
        for (let index = 0; index < units.length; index += 1) {
            const unit = units[index];
            const line = start + index;
            if (line > region.lastLine) {
                out.push({ text: unit, endIndex: null });
                continue;
            }
            if (line === region.firstLine || line === region.lastLine || /^\s*#/.test(unit)) {
                out.push({ text: "", endIndex: null });
                continue;
            }
            // A YAML sequence entry (`  - item`) reaches here only inside a paragraph;
            // as a list item block it is read as a list item, as it always was.
            const field = (0, work_intelligence_1.readFrontmatterLine)(unit);
            if (field === null) {
                out.push({ text: unit, endIndex: null });
                continue;
            }
            const vocabulary = exports.ARCHITECTURE_LABEL_VOCABULARY[field.key];
            if (field.blockScalar !== null) {
                const keyIndent = unit.length - unit.trimStart().length;
                const body = [];
                let end = index;
                while (end + 1 < units.length && start + end + 1 < region.lastLine) {
                    const next = units[end + 1];
                    if (next.trim().length > 0 && next.length - next.trimStart().length <= keyIndent)
                        break;
                    body.push(next.trim());
                    end += 1;
                }
                out.push({
                    text: body.some((line) => line.length > 0)
                        ? `${field.key}: ${body.join(field.blockScalar.startsWith("|") ? "\n" : " ")}`
                        : unit,
                    endIndex: end > index ? end : null,
                });
                for (let skipped = index + 1; skipped <= end; skipped += 1)
                    out.push({ text: "", endIndex: null });
                if (vocabulary !== undefined && !body.some((line) => line.length > 0)) {
                    this.diagnostic("architecture_evidence.frontmatter_block_scalar_unread", "info", `the frontmatter '${field.key}' block scalar has no indented lines in this block (a blank line ends what this reader attributes); it was not quoted`, block);
                    // `out` holds one entry per unit, so the key's entry is at `index`.
                    out[index] = { text: "", endIndex: null };
                }
                index = end;
                continue;
            }
            if (field.value.startsWith("[") || field.value.startsWith("{")) {
                if (vocabulary !== undefined) {
                    this.diagnostic("architecture_evidence.frontmatter_flow_collection_unsupported", "info", `the frontmatter '${field.key}' value is a YAML flow collection; this reader quotes scalars and block lists, not flow collections`, block);
                }
                out.push({ text: "", endIndex: null });
                continue;
            }
            out.push({ text: `${field.key}: ${unquoteYamlScalar(field.value)}`, endIndex: null });
        }
        return out;
    }
    readBlock(block) {
        // The text decoder has no frontmatter construct, so a YAML comment line
        // (`# assumption: …`) inside frontmatter arrives as an ATX title or heading.
        // It is a comment: it neither opens nor closes anything.
        if (TITULAR_BLOCK_KINDS.has(block.kind) && this.inFrontmatter(block))
            return;
        if (TITULAR_BLOCK_KINDS.has(block.kind)) {
            this.lastListItem = null;
            this.readHeading(block.text, block);
            return;
        }
        if (block.kind === "code") {
            this.lastListItem = null;
            this.closePendingList();
            this.closeSection();
            return;
        }
        const rawUnits = unitsOf(block.text);
        if (this.continuesListItem(block, rawUnits))
            return;
        this.lastListItem = null;
        const readable = this.readableUnits(block, rawUnits);
        const units = readable.map((unit) => unit.text);
        if (!this.inFrontmatter(block)) {
            const setext = setextHeadingText(block, units);
            if (setext !== null) {
                this.readHeading(setext, block);
                return;
            }
        }
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
            this.readLabelledBlock(block, units, labelled, readable);
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
            const kept = units.filter((unit) => unit.trim().length > 0 &&
                !THEMATIC_BREAK.test(unit) &&
                !this.skipsMember(unit, section, block));
            if (kept.length > 0) {
                if (this.emit(section.statementClass, kept.join("\n"), block.text, "section_heading", section.label, block, null)) {
                    section.members += 1;
                }
            }
        }
    }
    inFrontmatter(block) {
        return (this.frontmatter !== null &&
            block.locator.kind === "line_span" &&
            block.locator.line_start <= this.frontmatter.lastLine);
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
    /**
     * Items read one unit at a time, each attributed to the open declaration.
     *
     * A list item is one item however many lines it has: a Word list paragraph
     * with a soft line break arrives as one block of two units, and is one
     * statement cited at its first kept unit. A Markdown list item is always one
     * line, and the line after it, when it continues the item, is joined by
     * `continuesListItem`.
     */
    readMembers(block, units, statementClass, form, label, owner) {
        const kept = [];
        for (const [index, unit] of units.entries()) {
            if (unit.trim().length === 0 ||
                THEMATIC_BREAK.test(unit) ||
                this.skipsMember(unit, { statementClass, label }, block))
                continue;
            kept.push({ index, unit });
        }
        if (block.kind === "list_item" && kept.length > 1) {
            const first = kept[0];
            const last = kept[kept.length - 1];
            const joined = kept.map((entry) => entry.unit).join("\n");
            if (this.emit(statementClass, joined, joined, form, label, block, first.index, last.index))
                owner.members += 1;
            return;
        }
        for (const { index, unit } of kept) {
            const draft = this.emit(statementClass, unit, unit, form, label, block, index);
            if (draft === null)
                continue;
            owner.members += 1;
            if (block.kind === "list_item" && block.locator.kind === "line_span") {
                this.lastListItem = { draft, raw: unit, excerpt: unit, lineEnd: block.locator.line_end };
            }
        }
    }
    /**
     * A block holding at least one vocabulary label, read unit by unit.
     *
     * `Objective: ship it` is a statement on its own line, and running text on the
     * lines directly after it continues it: a soft line break is not a statement
     * boundary in any format. `Constraints:` with nothing after the colon opens a
     * list: the units after it in the same block belong to it, and if there are
     * none, the list items that follow the block do. A unit that is neither — a
     * label of another vocabulary, a work signal — belongs to the open heading
     * section if there is one, and to nothing otherwise: a label on line three
     * does not reach back to claim lines one and two.
     */
    readLabelledBlock(block, units, labelled, readable) {
        let open = null;
        let field = null;
        for (const [index, unit] of units.entries()) {
            const hit = labelled[index];
            if (hit !== null) {
                if (open !== null && open.members === 0) {
                    this.diagnostic("architecture_evidence.empty_declaration", "warning", `'${open.label}:' declares a ${open.statementClass} list and nothing follows it that this reader can attribute to it`, block);
                }
                open = null;
                field = null;
                if (hit.value.length > 0) {
                    const endIndex = readable[index]?.endIndex ?? null;
                    const draft = this.emit(hit.statementClass, hit.value, unit, "field_label", hit.label, block, index, endIndex);
                    // A block-scalar value already holds its own lines; nothing continues it.
                    if (draft !== null && endIndex === null)
                        field = { draft, raw: hit.value, excerpt: unit };
                }
                else {
                    open = { statementClass: hit.statementClass, label: hit.label, members: 0 };
                }
                continue;
            }
            if (unit.trim().length === 0) {
                field = null;
                continue;
            }
            if (field !== null && isPlainUnit(unit)) {
                const raw = `${field.raw}\n${unit}`;
                const excerpt = `${field.excerpt}\n${unit}`;
                if (this.extend(field.draft, raw, excerpt, block)) {
                    field.raw = raw;
                    field.excerpt = excerpt;
                    field.draft.unit_end_index = index;
                }
                else {
                    field = null;
                }
                continue;
            }
            field = null;
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
            this.pendingList = {
                statementClass: open.statementClass,
                label: open.label,
                members: 0,
                block,
            };
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
 * `line_start + k`, and the locator says exactly that line; a statement that
 * continues to unit *m*, or into the next blocks, ends on the line it ends on.
 * Every other locator kind has no coordinate finer than the block, and the
 * block's own locator is cited verbatim; the unit offset is carried beside it
 * rather than converted into a line number the format does not have.
 */
function architectureStatementLocator(block, unitIndex, unitEndIndex = null, continuationBlocks = []) {
    const locator = block.locator;
    if (locator.kind === "line_span" && unitIndex !== null) {
        const line = locator.line_start + unitIndex;
        let end = locator.line_start + (unitEndIndex ?? unitIndex);
        const last = continuationBlocks[continuationBlocks.length - 1];
        if (last !== undefined && last.locator.kind === "line_span")
            end = last.locator.line_end;
        if (line <= locator.line_end && end >= line)
            return { kind: "line_span", line_start: line, line_end: end };
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
        heading_grammar: {
            number_prefix: HEADING_NUMBER_PREFIX.source,
            qualifier_suffix: HEADING_QUALIFIER_SUFFIX.source,
            setext_underline: SETEXT_UNDERLINE.source,
            unrecognized_vocabulary_heading_diagnosed: true,
        },
        continuation: {
            commonmark_lazy_list_item: true,
            soft_break_in_labelled_value: true,
            soft_break_in_list_item: true,
            continuation_requires_plain_text: true,
        },
        frontmatter: {
            open_delimiter: work_intelligence_1.FRONTMATTER_OPEN_DELIMITER,
            close_delimiters: [...work_intelligence_1.FRONTMATTER_CLOSE_DELIMITERS],
            line_limit: work_intelligence_1.FRONTMATTER_LINE_LIMIT,
            yaml_comments_stripped: true,
            quoted_scalars_unquoted: true,
            block_scalars_read_within_block: true,
            flow_collections_reported: true,
        },
        thematic_break: THEMATIC_BREAK.source,
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