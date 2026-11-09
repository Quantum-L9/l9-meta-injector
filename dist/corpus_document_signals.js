"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_LISTED_SIGNALS_PER_FORMAT = exports.CORPUS_DOCUMENT_SIGNALS_SCHEMA = void 0;
exports.buildCorpusDocumentSignals = buildCorpusDocumentSignals;
exports.renderCorpusDocumentSignals = renderCorpusDocumentSignals;
// corpus_document_signals.ts — what the decoders read, and where it went.
//
// Coverage says how many documents were decoded. That is a necessary number and
// it is not a sufficient one, because a decoder can be wired to the scan, report
// a hundred percent coverage of the PDFs on a disk, and have contributed nothing
// to a single candidate — the text decoded into a record that no later layer
// read. A report of that shape looks like success and means nothing, so this
// file measures the other half: not only that the bytes were opened, but that
// what came out of them reached the analysis.
//
// Hence `analysis_participation`, and hence its `by_format` breakdown. "Eleven
// PDFs decoded, zero PDFs named by any candidate" is precisely the failure this
// artifact exists to make visible, and it is invisible in a coverage ratio.
//
// The locator inventory is the second claim. Every block carries a coordinate in
// its own format's terms — a page and an index for a PDF, a slide and a shape for
// a deck, a sheet and a cell reference for a spreadsheet, a cell index for a
// notebook — and never a line number invented for a binary file that has no
// lines. `locator_examples` prints real ones so the claim is checkable rather
// than asserted.
const corpus_analysis_1 = require("./corpus_analysis");
const ordering_1 = require("./ordering");
/**
 * Schema of this projection.
 *
 * Renamed from `l9.corpus-document-signals/v1` when the document gained the
 * block-bound evidence records below. A reader that understood the old name was
 * reading a document of counts; this one carries claims and the coordinates they
 * were read at, which is a different contract rather than more of the same one.
 */
exports.CORPUS_DOCUMENT_SIGNALS_SCHEMA = "l9.document-signals/v1";
/**
 * How many evidence records the document lists per format.
 *
 * The listing is a sample; the counts beside it are complete. A corpus of ten
 * thousand decoded documents states far more than a person will read, and a file
 * that grew without bound would be one nobody opens. What is never bounded is the
 * *count*: `signal_count` is every claim read, `listed_signal_count` is how many
 * appear below it, and their difference is stated rather than left to subtraction.
 */
exports.MAX_LISTED_SIGNALS_PER_FORMAT = 50;
function tally(counts) {
    return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => (0, ordering_1.compareCodePoints)(a.name, b.name));
}
function bump(counts, key) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
}
/** Build the document-signals projection for one run. */
function buildCorpusDocumentSignals(input) {
    const byFormat = new Map();
    const blockKinds = new Map();
    const locatorKinds = new Map();
    const examples = new Map();
    for (const document of input.documents) {
        let accumulator = byFormat.get(document.format);
        if (accumulator === undefined) {
            accumulator = {
                format: document.format,
                decoderId: document.decoder_id,
                decoderVersion: document.decoder_version,
                eligible: 0,
                decoded: 0,
                blocks: 0,
                refusals: new Map(),
                locatorKinds: new Set(),
                interpreted: 0,
                lexical: 0,
                candidates: 0,
            };
            byFormat.set(document.format, accumulator);
        }
        accumulator.eligible += 1;
        if (!document.decoded) {
            bump(accumulator.refusals, document.reason ?? "unknown");
            continue;
        }
        accumulator.decoded += 1;
        accumulator.blocks += document.blocks.length;
        if (input.interpreted.has(document.virtual_source_id))
            accumulator.interpreted += 1;
        if (input.lexicallyAnalyzed.has(document.virtual_source_id))
            accumulator.lexical += 1;
        if (input.candidateMembers.has(document.virtual_source_id))
            accumulator.candidates += 1;
        for (const block of document.blocks) {
            bump(blockKinds, block.kind);
            const kind = String(block.locator.kind ?? "unknown");
            bump(locatorKinds, kind);
            accumulator.locatorKinds.add(kind);
            // One example per format-and-locator-kind pair, chosen by the lowest
            // block id so the choice is a property of the corpus rather than of the
            // order the filesystem happened to be walked in.
            const key = `${document.format}\u001f${kind}`;
            const existing = examples.get(key);
            if (existing === undefined || (0, ordering_1.compareCodePoints)(block.block_id, existing.block_id) < 0) {
                examples.set(key, {
                    format: document.format,
                    block_id: block.block_id,
                    kind,
                    locator: block.locator,
                });
            }
        }
    }
    const accumulators = [...byFormat.values()].sort((a, b) => (0, ordering_1.compareCodePoints)(a.format, b.format));
    const decodedTotal = accumulators.reduce((sum, entry) => sum + entry.decoded, 0);
    return {
        schema: exports.CORPUS_DOCUMENT_SIGNALS_SCHEMA,
        corpus_source_snapshot_id: input.corpusSourceSnapshotId,
        corpus_analysis_id: input.corpusAnalysisId,
        decoder_profiles: [...input.decoderProfiles].sort(ordering_1.compareCodePoints),
        formats: accumulators.map((entry) => ({
            format: entry.format,
            decoder_id: entry.decoderId,
            decoder_version: entry.decoderVersion,
            eligible_count: entry.eligible,
            decoded_count: entry.decoded,
            block_count: entry.blocks,
            refusals: tally(entry.refusals),
            locator_kinds: [...entry.locatorKinds].sort(ordering_1.compareCodePoints),
        })),
        block_kinds: tally(blockKinds),
        locator_kinds: tally(locatorKinds),
        analysis_participation: {
            decoded_document_count: decodedTotal,
            interpreted_count: accumulators.reduce((sum, entry) => sum + entry.interpreted, 0),
            lexically_analyzed_count: accumulators.reduce((sum, entry) => sum + entry.lexical, 0),
            candidate_member_count: accumulators.reduce((sum, entry) => sum + entry.candidates, 0),
            by_format: accumulators.map((entry) => ({
                format: entry.format,
                decoded_count: entry.decoded,
                interpreted_count: entry.interpreted,
                lexically_analyzed_count: entry.lexical,
                candidate_member_count: entry.candidates,
            })),
        },
        locator_examples: [...examples.values()].sort((a, b) => {
            const byFormatName = (0, ordering_1.compareCodePoints)(a.format, b.format);
            if (byFormatName !== 0)
                return byFormatName;
            return (0, ordering_1.compareCodePoints)(a.kind, b.kind);
        }),
        block_signals: buildBlockSignalEvidence(input),
    };
}
/** Total order over evidence records, so the listing never depends on run order. */
function compareRecords(left, right) {
    return ((0, ordering_1.compareCodePoints)(left.source_path, right.source_path) ||
        (0, ordering_1.compareCodePoints)(left.block_id, right.block_id) ||
        (0, ordering_1.compareCodePoints)(left.predicate, right.predicate) ||
        (0, ordering_1.compareCodePoints)(left.object, right.object));
}
function toRecord(signal) {
    return {
        artifact_id: signal.artifact_id,
        source_path: signal.source_path,
        format: signal.format,
        raw_content_hash: signal.raw_content_hash,
        normalized_document_id: signal.normalized_document_id,
        decoder_id: signal.decoder_id,
        decoder_version: signal.decoder_version,
        block_id: signal.block_id,
        block_kind: signal.block_kind,
        structured_locator: signal.structured_locator,
        predicate: signal.predicate,
        object: signal.object,
        bounded_excerpt: signal.bounded_excerpt,
        evidence_class: signal.evidence_class,
        confidence: signal.confidence,
        extractor_id: signal.extractor_id,
    };
}
function buildBlockSignalEvidence(input) {
    const byFormat = new Map();
    const predicates = new Map();
    const documents = new Set();
    for (const signal of input.blockSignals) {
        documents.add(signal.artifact_id);
        bump(predicates, signal.predicate);
        let accumulator = byFormat.get(signal.format);
        if (accumulator === undefined) {
            accumulator = {
                format: signal.format,
                documents: new Set(),
                predicates: new Map(),
                records: [],
            };
            byFormat.set(signal.format, accumulator);
        }
        accumulator.documents.add(signal.artifact_id);
        bump(accumulator.predicates, signal.predicate);
        accumulator.records.push(toRecord(signal));
    }
    return {
        profile_id: input.blockProfile.profile_id,
        profile_version: input.blockProfile.profile_version,
        profile_hash: input.blockProfile.profile_hash,
        extractor_id: input.blockProfile.extractor_id,
        document_count: documents.size,
        signal_count: input.blockSignals.length,
        predicates: tally(predicates),
        by_format: [...byFormat.values()]
            .sort((a, b) => (0, ordering_1.compareCodePoints)(a.format, b.format))
            .map((entry) => {
            // Sorted before slicing, so the listed sample is the same sample on every
            // run over the same corpus rather than whichever records arrived first.
            const sorted = [...entry.records].sort(compareRecords);
            const listed = sorted.slice(0, exports.MAX_LISTED_SIGNALS_PER_FORMAT);
            return {
                format: entry.format,
                documents_with_signals: entry.documents.size,
                signal_count: sorted.length,
                listed_signal_count: listed.length,
                omitted_signal_count: sorted.length - listed.length,
                predicates: tally(entry.predicates),
                records: listed,
            };
        }),
    };
}
/** Canonical bytes of the document-signals projection. */
function renderCorpusDocumentSignals(signals) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(signals)}\n`;
}
//# sourceMappingURL=corpus_document_signals.js.map