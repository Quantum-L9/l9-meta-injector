"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_PRIORITY_STATEMENT = exports.UNDECODED_DOCUMENT_EXTENSIONS = exports.OCR_REQUIRED_EXTENSIONS = exports.CORPUS_COVERAGE_SCHEMA = void 0;
exports.coverageRatio = coverageRatio;
exports.formatCounts = formatCounts;
exports.renderCorpusCoverage = renderCorpusCoverage;
// corpus_coverage.ts — what the scan reached, and what it did not.
//
// A coverage report is the honest half of an archaeology tool. Every number in
// `corpus-index.json` is about the documents that could be read; this file is
// about the ones that could not, and about the exact fraction of the corpus each
// analysis actually saw.
//
// The distinction it keeps carefully is between *not supported* and *not present*.
// A PDF is a text-bearing document this release does not decode: it is counted as
// an unsupported format, by extension, so an operator can see precisely how much
// of their archive is invisible to the current decoder set. A PNG is not a
// document that failed to decode; it is a document that requires OCR, which this
// package does not perform and does not pretend to.
//
// The reasoning handoff at the end points a downstream layer at the evidence and
// stops. It carries references and counts, and no priority — deciding what to do
// with a corpus is a judgement, and this producer does not make judgements.
const corpus_analysis_1 = require("./corpus_analysis");
const ordering_1 = require("./ordering");
exports.CORPUS_COVERAGE_SCHEMA = "l9.corpus-coverage/v1";
/** Raster formats that carry no extractable text layer without OCR. */
exports.OCR_REQUIRED_EXTENSIONS = [
    ".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp",
];
/**
 * Text-bearing formats this release does not decode.
 *
 * Listed rather than inferred, so the gap is a stated set an operator can read
 * off the report and a future decoder can be measured against.
 */
exports.UNDECODED_DOCUMENT_EXTENSIONS = [
    ".doc", ".docx", ".epub", ".key", ".numbers", ".odp", ".ods", ".odt", ".pages",
    ".pdf", ".ppt", ".pptx", ".rtf", ".xls", ".xlsx",
];
exports.NO_PRIORITY_STATEMENT = "This handoff carries evidence and counts. It contains no priority, no ranking and "
    + "no recommendation, and none can be read out of the order of any list in it.";
/** Build a ratio, treating "nothing was eligible" as complete coverage. */
function coverageRatio(covered, eligible) {
    return {
        eligible,
        covered,
        ratio: eligible === 0 ? 1 : Math.round((covered / eligible) * 1e6) / 1e6,
    };
}
/** Group counts and bytes by extension, in code-point order. */
function formatCounts(entries) {
    const grouped = new Map();
    for (const entry of entries) {
        const existing = grouped.get(entry.extension) ?? { count: 0, bytes: 0 };
        existing.count += 1;
        existing.bytes += entry.bytes;
        grouped.set(entry.extension, existing);
    }
    return [...grouped.entries()]
        .map(([extension, totals]) => ({ extension, ...totals }))
        .sort((a, b) => (0, ordering_1.compareCodePoints)(a.extension, b.extension));
}
/** Canonical bytes of a coverage report. */
function renderCorpusCoverage(coverage) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(coverage)}\n`;
}
//# sourceMappingURL=corpus_coverage.js.map