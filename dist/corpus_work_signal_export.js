"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOCUMENT_WORK_SIGNALS_MANIFEST_FILE = exports.DOCUMENT_WORK_SIGNALS_PAYLOAD_FILE = exports.DOCUMENT_WORK_SIGNALS_MANIFEST_SCHEMA = exports.DOCUMENT_WORK_SIGNALS_SCHEMA = void 0;
exports.renderDocumentWorkSignalRecord = renderDocumentWorkSignalRecord;
exports.buildDocumentWorkSignalExport = buildDocumentWorkSignalExport;
exports.documentWorkSignalsRef = documentWorkSignalsRef;
exports.verifyDocumentWorkSignalExport = verifyDocumentWorkSignalExport;
// corpus_work_signal_export.ts — the complete machine payload, and its receipt.
//
// `document-signals.json` is a report. It states complete counts and lists a
// bounded, deterministic sample of the evidence behind them, because a corpus of
// ten thousand documents states more than a person will read and a file that
// grew without bound would be one nobody opens.
//
// That is the right shape for a report and the wrong shape for a contract. A
// downstream consumer asking "what did this corpus find" cannot be handed fifty
// of a hundred and thirty-seven records and a number saying there were more:
// it would have to either trust the count without the evidence, reconstruct the
// missing records from somewhere else, or read this package's internal cache.
// All three are worse than emitting the records.
//
// So the report stays a report, and this module emits the whole set beside it:
// one JSONL line per signal, never sampled, never truncated, with a manifest
// that says how many there are and hashes what was written. A consumer can prove
// it received exactly what was produced, and this package can prove it before
// publishing anything.
//
// Two hashes, because they answer different questions. `payload_artifact_hash`
// is over the exact bytes — it detects a byte that changed in transit.
// `payload_semantic_hash` is over the records — it is the same in every output
// directory on every machine, so two generations can be compared without
// comparing file paths.
const corpus_analysis_1 = require("./corpus_analysis");
const ordering_1 = require("./ordering");
const repository_model_1 = require("./repository_model");
/** Schema of the complete payload. One record per line. */
exports.DOCUMENT_WORK_SIGNALS_SCHEMA = "l9.document-work-signals/v1";
/** Schema of the payload's completeness and integrity receipt. */
exports.DOCUMENT_WORK_SIGNALS_MANIFEST_SCHEMA = "l9.document-work-signals-manifest/v1";
/** Where the payload and its manifest are written inside a generation. */
exports.DOCUMENT_WORK_SIGNALS_PAYLOAD_FILE = "document-work-signals.jsonl";
exports.DOCUMENT_WORK_SIGNALS_MANIFEST_FILE = "document-work-signals.manifest.json";
/**
 * Total order over signals.
 *
 * `signal_id` is last and is what makes the order total: everything before it
 * can legitimately repeat, and two signals identical in all of it would
 * otherwise sort non-deterministically. Ties there are impossible, because two
 * records agreeing on the id are the same record and are refused as duplicates.
 */
function compareRecords(left, right) {
    return ((0, ordering_1.compareCodePoints)(left.artifact_id, right.artifact_id)
        || (0, ordering_1.compareCodePoints)(left.block_id, right.block_id)
        || (0, ordering_1.compareCodePoints)(left.predicate, right.predicate)
        || (0, ordering_1.compareCodePoints)(left.object, right.object)
        || (0, ordering_1.compareCodePoints)(left.signal_id, right.signal_id));
}
/** One record, canonically rendered onto a single line. */
function renderDocumentWorkSignalRecord(record) {
    return (0, corpus_analysis_1.canonicalCorpusJson)(record, 0);
}
function tallyFormats(records) {
    const byFormat = new Map();
    for (const record of records) {
        const entry = byFormat.get(record.format) ?? { signals: 0, documents: new Set() };
        entry.signals += 1;
        entry.documents.add(record.artifact_id);
        byFormat.set(record.format, entry);
    }
    return [...byFormat.entries()]
        .map(([format, entry]) => ({
        format,
        document_count: entry.documents.size,
        signal_count: entry.signals,
    }))
        .sort((a, b) => (0, ordering_1.compareCodePoints)(a.format, b.format));
}
function tallyPredicates(records) {
    const byPredicate = new Map();
    for (const record of records) {
        byPredicate.set(record.predicate, (byPredicate.get(record.predicate) ?? 0) + 1);
    }
    return [...byPredicate.entries()]
        .map(([predicate, signal_count]) => ({ predicate, signal_count }))
        .sort((a, b) => (0, ordering_1.compareCodePoints)(a.predicate, b.predicate));
}
/**
 * Build the complete payload and its manifest.
 *
 * Refuses a duplicate `signal_id` rather than collapsing it. Two records under
 * one id mean either that the identity formula is losing a distinction it must
 * keep or that a signal was produced twice; both are defects, and a payload that
 * silently deduplicated them would report a record count no consumer could
 * reconcile against the corpus.
 */
function buildDocumentWorkSignalExport(input) {
    const records = [...input.records].sort(compareRecords);
    const seen = new Set();
    for (const record of records) {
        if (seen.has(record.signal_id)) {
            throw new Error(`document-work-signals: duplicate signal_id ${record.signal_id} `
                + `(${record.source_path} ${record.predicate}); the payload must carry each signal once`);
        }
        seen.add(record.signal_id);
    }
    // A trailing newline on every line, including the last: a JSONL reader that
    // splits on the separator then gets one empty trailing field rather than a
    // final record that looks truncated.
    const payloadJsonl = records.map((record) => `${renderDocumentWorkSignalRecord(record)}\n`).join("");
    const manifest = {
        schema: exports.DOCUMENT_WORK_SIGNALS_MANIFEST_SCHEMA,
        corpus_source_snapshot_id: input.corpusSourceSnapshotId,
        corpus_analysis_id: input.corpusAnalysisId,
        profile_id: input.profile.profile_id,
        profile_version: input.profile.profile_version,
        profile_hash: input.profile.profile_hash,
        payload_file: exports.DOCUMENT_WORK_SIGNALS_PAYLOAD_FILE,
        record_count: records.length,
        document_count: new Set(records.map((record) => record.artifact_id)).size,
        by_format: tallyFormats(records),
        by_predicate: tallyPredicates(records),
        payload_byte_length: Buffer.byteLength(payloadJsonl, "utf8"),
        payload_artifact_hash: (0, repository_model_1.sha256TextPrefixed)(payloadJsonl),
        // Over the records rather than the bytes, so a generation written to another
        // directory on another machine produces the same value.
        payload_semantic_hash: (0, repository_model_1.sha256TextPrefixed)((0, corpus_analysis_1.canonicalCorpusJson)({ schema: exports.DOCUMENT_WORK_SIGNALS_SCHEMA, records }, 0)),
    };
    return {
        records,
        manifest,
        payloadJsonl,
        manifestJson: `${(0, corpus_analysis_1.canonicalCorpusJson)(manifest)}\n`,
    };
}
/** The snapshot-sized reference to a payload. */
function documentWorkSignalsRef(manifest) {
    return {
        schema: exports.DOCUMENT_WORK_SIGNALS_SCHEMA,
        manifest_ref: exports.DOCUMENT_WORK_SIGNALS_MANIFEST_FILE,
        payload_ref: manifest.payload_file,
        record_count: manifest.record_count,
        payload_semantic_hash: manifest.payload_semantic_hash,
        payload_artifact_hash: manifest.payload_artifact_hash,
    };
}
/**
 * Read the payload back the way a consumer would, reporting what would not parse.
 *
 * The trailing newline is checked here rather than tolerated: a payload whose
 * last line is a record is a payload that was truncated mid-write, and a reader
 * splitting on newlines cannot tell that from a complete one.
 */
function readPayloadRecords(payloadJsonl) {
    const problems = [];
    const lines = payloadJsonl.length === 0 ? [] : payloadJsonl.split("\n");
    if (payloadJsonl.length > 0 && lines[lines.length - 1] !== "") {
        problems.push("payload does not end with a newline");
    }
    const bodies = lines.filter((line, index) => !(index === lines.length - 1 && line === ""));
    const records = [];
    for (const [index, line] of bodies.entries()) {
        if (line.length === 0) {
            problems.push(`payload line ${index + 1} is empty`);
            continue;
        }
        try {
            records.push(JSON.parse(line));
        }
        catch (error) {
            problems.push(`payload line ${index + 1} is not valid JSON: ${error.message}`);
        }
    }
    return { records, problems };
}
/** The manifest's claims about the bytes, against the bytes. */
function checkPayloadAgainstManifest(manifest, payloadJsonl, records) {
    const problems = [];
    if (records.length !== manifest.record_count) {
        problems.push(`manifest says ${manifest.record_count} record(s) and the payload carries ${records.length}`);
    }
    const byteLength = Buffer.byteLength(payloadJsonl, "utf8");
    if (byteLength !== manifest.payload_byte_length) {
        problems.push(`manifest says ${manifest.payload_byte_length} byte(s) and the payload is ${byteLength}`);
    }
    const artifactHash = (0, repository_model_1.sha256TextPrefixed)(payloadJsonl);
    if (artifactHash !== manifest.payload_artifact_hash) {
        problems.push(`payload artifact hash ${artifactHash} does not match the manifest's `
            + `${manifest.payload_artifact_hash}`);
    }
    if (records.length === manifest.record_count) {
        // Only worth computing when the record set parsed whole; over a short read it
        // would report a second failure with the same cause as the first.
        const semanticHashValue = (0, repository_model_1.sha256TextPrefixed)((0, corpus_analysis_1.canonicalCorpusJson)({ schema: exports.DOCUMENT_WORK_SIGNALS_SCHEMA, records }, 0));
        if (semanticHashValue !== manifest.payload_semantic_hash) {
            problems.push(`payload semantic hash ${semanticHashValue} does not match the manifest's `
                + `${manifest.payload_semantic_hash}`);
        }
    }
    return problems;
}
/** Every record's own id, and the two ids it points at. */
function checkRecordIdentities(records, knownArtifactIds, knownNormalizedDocumentIds) {
    const problems = [];
    const seen = new Set();
    for (const record of records) {
        if (seen.has(record.signal_id)) {
            problems.push(`duplicate signal_id ${record.signal_id}`);
        }
        seen.add(record.signal_id);
        if (!knownArtifactIds.has(record.artifact_id)) {
            problems.push(`signal ${record.signal_id} names artifact ${record.artifact_id}, which this corpus did not observe`);
        }
        if (record.normalized_document_id !== null
            && !knownNormalizedDocumentIds.has(record.normalized_document_id)) {
            problems.push(`signal ${record.signal_id} names normalized document ${record.normalized_document_id}, `
                + "which this corpus did not produce");
        }
    }
    return problems;
}
/** A grouping that does not sum to the whole is a grouping that lost something. */
function checkGroupTotals(manifest) {
    const problems = [];
    const formatTotal = manifest.by_format.reduce((sum, entry) => sum + entry.signal_count, 0);
    if (formatTotal !== manifest.record_count) {
        problems.push(`by_format totals ${formatTotal} and the manifest states ${manifest.record_count}`);
    }
    const predicateTotal = manifest.by_predicate.reduce((sum, entry) => sum + entry.signal_count, 0);
    if (predicateTotal !== manifest.record_count) {
        problems.push(`by_predicate totals ${predicateTotal} and the manifest states ${manifest.record_count}`);
    }
    return problems;
}
/**
 * Prove a payload is the complete set its manifest claims, before anything is
 * published.
 *
 * Every check here answers a question a consumer would otherwise have to take on
 * trust, and each returns a stated reason rather than a boolean: a validation
 * that fails without saying which record broke it sends a reader to the whole
 * file.
 *
 * The checks are separate functions and the order they run in is the order a
 * reader wants their answers: can this be read at all, is it the bytes the
 * manifest describes, does it agree with the report, does every record resolve,
 * and do the groupings account for the whole. Each returns its own problems, so
 * one failing check never hides the next.
 */
function verifyDocumentWorkSignalExport(input) {
    const { manifest, payloadJsonl } = input;
    const { records, problems: readProblems } = readPayloadRecords(payloadJsonl);
    const reportProblems = [];
    if (manifest.record_count !== input.reportSignalCount) {
        reportProblems.push(`the sampled report states ${input.reportSignalCount} signal(s) and the complete `
            + `payload manifest states ${manifest.record_count}`);
    }
    return [
        ...readProblems,
        ...checkPayloadAgainstManifest(manifest, payloadJsonl, records),
        ...reportProblems,
        ...checkRecordIdentities(records, input.knownArtifactIds, input.knownNormalizedDocumentIds),
        ...checkGroupTotals(manifest),
    ];
}
//# sourceMappingURL=corpus_work_signal_export.js.map