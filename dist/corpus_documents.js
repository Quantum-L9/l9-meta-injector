"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNDECODED_REASON_NOT_ELIGIBLE = exports.DOCUMENT_INDEX_SCHEMA = void 0;
exports.buildDocumentIndex = buildDocumentIndex;
exports.renderDocumentIndex = renderDocumentIndex;
exports.decodedDocumentsByArtifact = decodedDocumentsByArtifact;
// corpus_documents.ts — the normalized documents, written down.
//
// Decoding already happened. Every scan turns bytes into normalized text, hashes
// that text, counts its tokens and files the result in the cache under a key made
// of the source hash and the decoder's identity. What it never did was *emit* any
// of that: the record was a private interface, held in a map, discarded when the
// run ended.
//
// That was fine while the only consumer was the same run. It stops being fine the
// moment a later pass wants to reason over documents rather than over files,
// because such a pass needs three things it cannot recover afterwards:
//
//   - which artifact a document came from, so a conclusion can be traced back;
//   - the *exact source* content hash, so the document can be proven to describe
//     the bytes on disk rather than some other copy;
//   - which decoder produced it, at which version, so two documents are only
//     comparable when the same rules made them.
//
// So this module writes the index. It computes nothing new — every field here is
// already established during the scan — it just stops throwing it away.
//
// Two things the index deliberately is not. It is not a content store: the
// normalized text is not in it, only the hash of that text, because a document
// index that carried document bodies would be a second copy of the corpus. And it
// is not a decoding claim: an artifact no decoder opened still gets an entry,
// carrying `decoded: false` and the reason, because "this was not read" is
// exactly the fact a coverage-honest pipeline must be able to state.
const corpus_analysis_1 = require("./corpus_analysis");
const ordering_1 = require("./ordering");
/** Schema of the normalized-document index. */
exports.DOCUMENT_INDEX_SCHEMA = "l9.document-index/v1";
/**
 * Why an artifact has no document.
 *
 * Kept as a closed vocabulary so the summary can group by it. "No decoder claimed
 * this extension" and "a decoder tried and the bytes were not text" are different
 * facts about a corpus, and a single `undecoded` count would hide which one an
 * operator is looking at.
 */
exports.UNDECODED_REASON_NOT_ELIGIBLE = "no_decoder_claims_this_artifact";
function entryFor(artifact, decoderId, decoderVersion) {
    const normalized = artifact.normalized;
    const decoded = normalized?.decodes === true;
    return {
        artifact_id: artifact.artifactId,
        root_id: artifact.rootId,
        corpus_path: artifact.corpusPath,
        root_relative_path: artifact.rootRelativePath,
        content_hash: artifact.contentHash,
        normalized_document_id: artifact.normalizedDocumentId ?? null,
        decoder_id: decoderId,
        decoder_version: decoderVersion,
        decoded,
        undecoded_reason: decoded
            ? null
            : (normalized?.reason ?? exports.UNDECODED_REASON_NOT_ELIGIBLE),
        byte_length: normalized?.byte_length ?? artifact.sizeBytes ?? null,
        token_count: decoded ? (normalized?.token_count ?? 0) : null,
        normalized_content_hash: decoded ? (normalized?.normalized_content_hash ?? null) : null,
        is_archive_member: artifact.isArchiveMember,
        archive_ancestry: [...(artifact.archiveAncestry ?? [])],
    };
}
/** Build the index. Ordering is by corpus path, then artifact id, both code-point. */
function buildDocumentIndex(input) {
    const documents = input.artifacts
        .map((artifact) => entryFor(artifact, input.decoderId, input.decoderVersion))
        .sort((a, b) => (0, ordering_1.compareCodePoints)(a.corpus_path, b.corpus_path)
        || (0, ordering_1.compareCodePoints)(a.artifact_id, b.artifact_id));
    const distinct = new Set();
    const reasons = new Map();
    let decodedCount = 0;
    let tokens = 0;
    for (const document of documents) {
        if (document.decoded) {
            decodedCount += 1;
            tokens += document.token_count ?? 0;
            if (document.normalized_document_id !== null)
                distinct.add(document.normalized_document_id);
            continue;
        }
        const reason = document.undecoded_reason ?? exports.UNDECODED_REASON_NOT_ELIGIBLE;
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    return {
        schema: exports.DOCUMENT_INDEX_SCHEMA,
        corpus_snapshot_id: input.corpusSnapshotId,
        decoder: { decoder_id: input.decoderId, decoder_version: input.decoderVersion },
        summary: {
            artifact_count: documents.length,
            decoded_count: decodedCount,
            undecoded_count: documents.length - decodedCount,
            distinct_document_count: distinct.size,
            archive_member_count: documents.filter((document) => document.is_archive_member).length,
            total_token_count: tokens,
            undecoded_by_reason: [...reasons.entries()]
                .map(([reason, count]) => ({ reason, count }))
                .sort((a, b) => (0, ordering_1.compareCodePoints)(a.reason, b.reason)),
        },
        documents,
    };
}
/** Canonical bytes of a document index. */
function renderDocumentIndex(index) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(index)}\n`;
}
/** The decoded documents only, keyed by artifact id, for a downstream pass. */
function decodedDocumentsByArtifact(index) {
    const out = new Map();
    for (const document of index.documents) {
        if (document.decoded)
            out.set(document.artifact_id, document);
    }
    return out;
}
//# sourceMappingURL=corpus_documents.js.map