"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOCUMENT_BLOCK_EXTRACTOR_ID = exports.DOCUMENT_BLOCK_PROFILE_VERSION = exports.DOCUMENT_BLOCK_PROFILE_ID = void 0;
exports.documentBlockProfileHash = documentBlockProfileHash;
exports.readDocumentBlockSignals = readDocumentBlockSignals;
const interpretation_1 = require("../interpretation");
const ordering_1 = require("../ordering");
const repository_model_1 = require("../repository_model");
const work_intelligence_1 = require("./work_intelligence");
/** Identity of the block-signal policy. Bumped when these rules change. */
exports.DOCUMENT_BLOCK_PROFILE_ID = "meta-injector-document-block-signals";
exports.DOCUMENT_BLOCK_PROFILE_VERSION = "1.0.0";
/** The single extractor this profile runs, named in every assertion it produces. */
exports.DOCUMENT_BLOCK_EXTRACTOR_ID = "document-block-work-intelligence/v1";
/**
 * Blocks whose text is never read for statements.
 *
 * `code` mirrors the fenced-code exclusion the Markdown reader already applies: a
 * shell transcript containing `# deploy` is not a heading and `- [ ] item` inside
 * an example is not a task.
 *
 * `title` and `heading` are excluded from *statement* reading — not from the
 * module — for the same reason `labelSignal` refuses an ATX heading: a section
 * called "Status: Blocked" names a section. Titles are read separately below,
 * for the markers a title legitimately carries.
 */
const UNREAD_BLOCK_KINDS = new Set(["code", "title", "heading"]);
/** Block kinds that carry a document's own name or structure. */
const TITULAR_BLOCK_KINDS = new Set(["title", "heading"]);
/**
 * Hash of the rules this pass applies.
 *
 * A caller that caches block signals keys them on this, so a change to the
 * vocabulary invalidates what the previous vocabulary produced rather than
 * serving it under the new profile's name.
 */
function documentBlockProfileHash() {
    return (0, repository_model_1.semanticHash)({
        id: exports.DOCUMENT_BLOCK_PROFILE_ID,
        version: exports.DOCUMENT_BLOCK_PROFILE_VERSION,
        extractor_id: exports.DOCUMENT_BLOCK_EXTRACTOR_ID,
        evidence: "block_locator",
        ordering: "code-point",
        unread_block_kinds: [...UNREAD_BLOCK_KINDS].sort(ordering_1.compareCodePoints),
        leading_admonition_units: work_intelligence_1.LEADING_ADMONITION_UNITS,
    });
}
/** Split a block's text into the units a reader is offered, in order. */
function unitsOf(text) {
    return text.split(/\r?\n/);
}
/** The first line of a block that has any content, or null when it has none. */
function firstContentLine(text) {
    for (const line of unitsOf(text)) {
        if (line.trim().length > 0)
            return line;
    }
    return null;
}
/**
 * Milestones declared as a list under a `Milestones` heading.
 *
 * The Markdown reader recognizes the same shape and stops the section at the next
 * heading; here the section stops at the first block after the list that is not
 * another list item, which is the block-shaped statement of the same rule.
 */
function milestoneSectionDrafts(blocks) {
    const drafts = [];
    for (let index = 0; index < blocks.length; index++) {
        const opener = blocks[index];
        if (!TITULAR_BLOCK_KINDS.has(opener.kind))
            continue;
        if (!(0, work_intelligence_1.isMilestoneSectionHeading)(opener.text))
            continue;
        for (let member = index + 1; member < blocks.length; member++) {
            const block = blocks[member];
            if (block.kind !== "list_item")
                break;
            for (const line of unitsOf(block.text)) {
                // A milestone written as a checklist item is still a milestone; the
                // checkbox marker is task syntax rather than part of the milestone.
                const text = (0, work_intelligence_1.documentText)(line.replace(/^\s*\[[ xX]\]\s*/, ""));
                if (text.length === 0)
                    continue;
                drafts.push({
                    predicate: "work.milestone",
                    object: text,
                    excerpt: line,
                    evidenceClass: "observed",
                    confidence: "high",
                    block,
                });
            }
        }
    }
    return drafts;
}
/**
 * What the document's titular blocks say.
 *
 * The first titular block is the document's name; the rest are its structure. A
 * deck has a title slide and then section slides, and a Word document has a Title
 * style and then Heading styles, so the same rule reads both correctly.
 *
 * `document.heading` carries the heading text alone, where the Markdown reader
 * prefixes it with the heading level. A block has no level to report: the decoder
 * knows the paragraph used a Heading style, not which one, and writing `H1:` in
 * front of it would be a second fabricated coordinate.
 *
 * Status and kind markers are read from every titular block rather than only the
 * first. A slide titled `Q3 Roadmap` is the deck declaring it holds a roadmap,
 * and that is the statement scenario 2 of the contract asks to be found. The
 * confidence stays `medium`, exactly as it is for a Markdown title: a name is a
 * name first and a claim about the document second.
 */
function titularDrafts(blocks) {
    const drafts = [];
    let named = false;
    for (const block of blocks) {
        if (!TITULAR_BLOCK_KINDS.has(block.kind))
            continue;
        const line = firstContentLine(block.text);
        if (line === null)
            continue;
        const text = (0, work_intelligence_1.documentText)(line);
        if (text.length === 0)
            continue;
        const isName = block.kind === "title" && !named;
        if (isName)
            named = true;
        drafts.push({
            predicate: isName ? "document.title" : "document.heading",
            object: text,
            excerpt: line,
            evidenceClass: isName ? "declared" : "observed",
            confidence: "high",
            block,
        });
        if (block.kind !== "title")
            continue;
        for (const marker of (0, work_intelligence_1.readTitleMarkers)(text, line)) {
            drafts.push({
                predicate: marker.predicate,
                object: marker.object,
                excerpt: marker.excerpt,
                evidenceClass: marker.evidenceClass,
                confidence: marker.confidence,
                block,
            });
        }
    }
    return drafts;
}
/** Statements read line by line out of the blocks that carry body text. */
function statementDrafts(blocks) {
    const drafts = [];
    for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        if (UNREAD_BLOCK_KINDS.has(block.kind))
            continue;
        for (const line of unitsOf(block.text)) {
            const signal = (0, work_intelligence_1.readTextUnit)(line, {
                // "Near the top" is measured in blocks here and in lines in a text file.
                // Both answer the same question: a bare `> BLOCKED` under a heading
                // halfway down is about that section, not about the document.
                admonitionsAllowed: index < work_intelligence_1.LEADING_ADMONITION_UNITS,
                // A checkbox in a decoded block never carries the bullet that was drawn
                // beside it. Word keeps the marker in its numbering definition; PowerPoint
                // makes every body paragraph of a text shape a bullet by layout; a
                // worksheet cell has no list syntax at all. In Markdown the bullet has to
                // be present because Markdown has real list syntax and `[ ] x` without one
                // is bracketed prose — but by the time a document has been decoded into
                // blocks, that distinction no longer exists to be honoured. Requiring the
                // marker here would read every Markdown checklist and no Word or
                // PowerPoint one: the same list failing to be understood because of the
                // program it was written in.
                listMarkerImplied: true,
            });
            if (signal === null)
                continue;
            drafts.push({
                predicate: signal.predicate,
                object: signal.object,
                excerpt: signal.excerpt,
                evidenceClass: signal.evidenceClass,
                confidence: signal.confidence,
                block,
            });
        }
    }
    return drafts;
}
/** Total order over assertions, so the output never depends on reading order. */
function compareAssertions(left, right) {
    return ((0, ordering_1.compareCodePoints)(left.source_path, right.source_path)
        || (0, ordering_1.compareCodePoints)(left.evidence.block_id, right.evidence.block_id)
        || (0, ordering_1.compareCodePoints)(left.predicate, right.predicate)
        || (0, ordering_1.compareCodePoints)(left.object, right.object)
        || (0, ordering_1.compareCodePoints)(left.assertion_id, right.assertion_id));
}
/**
 * Read every work signal a decoded document states about itself.
 *
 * Never throws on malformed content: a document that cannot be read is a fact
 * about the corpus rather than a crash, and the decoder has already recorded the
 * ones that could not be opened at all.
 */
function readDocumentBlockSignals(input) {
    const drafts = [
        ...titularDrafts(input.blocks),
        ...milestoneSectionDrafts(input.blocks),
        ...statementDrafts(input.blocks),
    ];
    const assertions = [];
    const seen = new Set();
    for (const draft of drafts) {
        const excerpt = (0, interpretation_1.boundExcerpt)(draft.excerpt);
        // A refusal rather than a redaction: a redacted excerpt is no longer evidence
        // of anything, and this is the same rule the line-based path applies.
        if ((0, interpretation_1.looksSecret)(excerpt) || (0, interpretation_1.looksSecret)(draft.object))
            continue;
        const assertionId = (0, repository_model_1.stableId)("document_assertion", {
            block_id: draft.block.block_id,
            extractor_id: exports.DOCUMENT_BLOCK_EXTRACTOR_ID,
            object: draft.object,
            predicate: draft.predicate,
            source_path: input.sourcePath,
            subject_id: input.subjectId,
        });
        // Two identical claims from one block are one claim. A worksheet row repeated
        // in a merged range would otherwise be counted twice.
        if (seen.has(assertionId))
            continue;
        seen.add(assertionId);
        assertions.push({
            assertion_id: assertionId,
            subject_id: input.subjectId,
            predicate: draft.predicate,
            object: draft.object,
            source_path: input.sourcePath,
            source_content_hash: input.sourceContentHash,
            format: input.format,
            evidence: {
                normalized_document_id: input.normalizedDocumentId,
                decoder_id: input.decoderId,
                decoder_version: input.decoderVersion,
                block_id: draft.block.block_id,
                block_kind: draft.block.kind,
                locator: draft.block.locator,
            },
            evidence_excerpt: excerpt,
            evidence_class: draft.evidenceClass,
            authority: "source",
            confidence: draft.confidence,
            extractor_id: exports.DOCUMENT_BLOCK_EXTRACTOR_ID,
        });
    }
    return assertions.sort(compareAssertions);
}
//# sourceMappingURL=document_blocks.js.map