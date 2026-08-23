"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUALIFICATION_NO_PRIORITY_STATEMENT = exports.CORPUS_QUALIFICATION_SCHEMA = void 0;
exports.buildCorpusQualificationReport = buildCorpusQualificationReport;
exports.renderCorpusQualificationReport = renderCorpusQualificationReport;
// corpus_qualification.ts — the report a real corpus run has to be able to produce.
//
// Every other qualification in this package is a property test: it asserts that
// two runs agree, that a change invalidates what depends on it, that an
// interrupted scan resumes. Those tests are built on corpora written from
// constants, because a property is easiest to prove on a corpus whose every byte
// is stated in one place.
//
// This module answers the other question, which is not a property at all: run the
// engine over a mixed, awkward, read-only drive and say what actually happened.
// How many bytes were read, how much of the corpus the decoders could open, how
// much of it they could not, what the second run got out of the cache. Those are
// measurements rather than assertions, and they are the numbers an operator needs
// before pointing the tool at a disk they care about.
//
// Two rules the report keeps, both inherited rather than invented here:
//
//   - No absolute path appears in it. A corpus read from `/Volumes/OldSSD` and
//     the same corpus read from `/mnt/backup` are one corpus, so a mount point is
//     never part of what is reported about it.
//   - No number in it ranks anything. The counts say how many project candidates
//     were found, never which one to build. That boundary belongs to
//     `corpus_readiness.ts`, and this report stays on the same side of it.
const corpus_analysis_1 = require("./corpus_analysis");
const ordering_1 = require("./ordering");
const corpus_scan_1 = require("./corpus_scan");
/** Schema of the real-corpus qualification report. */
exports.CORPUS_QUALIFICATION_SCHEMA = "l9.corpus-qualification-report/v1";
exports.QUALIFICATION_NO_PRIORITY_STATEMENT = "This report measures one run over one corpus. Every field in it is a count, a ratio or "
    + "an identity. It contains no priority, no ranking and no recommendation about any "
    + "artifact, candidate or body of work it describes.";
function secondRunCache(stats) {
    return {
        enabled: stats.enabled,
        hit_ratio: stats.hit_ratio,
        hits: stats.hits,
        misses: stats.misses,
        writes: stats.writes,
        corrupt: stats.corrupt,
        stale_producer: stats.stale_producer,
        layers: stats.layers
            .map((layer) => ({
            layer: layer.layer,
            hits: layer.hits,
            misses: layer.misses,
            writes: layer.writes,
            corrupt: layer.corrupt,
        }))
            .sort((a, b) => (0, ordering_1.compareCodePoints)(a.layer, b.layer)),
    };
}
/**
 * Build the report from a cold run, the warm run that followed it, and the
 * caller's own comparison of the two.
 *
 * The measurements come from the cold run, because that is the run that read the
 * corpus. The cache ratio comes from the warm run, because that is the run the
 * ratio is a fact about.
 */
function buildCorpusQualificationReport(input) {
    const { cold, warm } = input;
    const coverage = cold.coverage;
    const summary = cold.candidates.summary;
    const handoff = coverage.reasoning_handoff;
    const profile = cold.candidates.analysis_profile;
    const extensions = new Set();
    for (const artifact of cold.snapshot.artifacts) {
        const basename = artifact.corpus_path.split("/").pop() ?? "";
        const dot = basename.lastIndexOf(".");
        extensions.add(dot > 0 ? basename.slice(dot).toLowerCase() : "");
    }
    const unsupported = coverage.unsupported_format_counts;
    return {
        schema: exports.CORPUS_QUALIFICATION_SCHEMA,
        corpus_id: cold.snapshot.corpus_id,
        corpus_snapshot_id: cold.snapshot.corpus_source_snapshot_id,
        corpus_analysis_id: cold.snapshot.analysis.corpus_analysis_id,
        corpus_status: cold.snapshot.corpus_status,
        missing_root_ids: [...cold.snapshot.missing_root_ids],
        verification: {
            mode: cold.snapshot.verification.mode,
            verification_class: cold.snapshot.verification.verification_class,
            fully_rehashed_artifact_count: cold.snapshot.verification.fully_rehashed_artifact_count,
            cached_hash_reuse_count: cold.snapshot.verification.cached_hash_reuse_count,
            unhashed_artifact_count: cold.snapshot.verification.unhashed_artifact_count,
        },
        root_packets: cold.snapshot.roots.map((root) => ({
            root_label: root.root_label,
            rmp_packet_id: root.rmp_packet_id,
            rmp_semantic_hash: root.rmp_semantic_hash,
            bundle_ref: root.bundle_ref,
            observation_status: root.observation_status,
        })),
        corpus_profile_hash: cold.candidates.corpus_profile_hash,
        producer_version: input.producerVersion,
        roots: cold.bindings
            .map((binding) => ({
            root_id: binding.root_id,
            root_label: binding.root_label,
            root_snapshot_id: binding.root_snapshot_id,
            source_kind: binding.source_kind,
            source_revision: binding.source_revision,
        }))
            .sort((a, b) => (0, ordering_1.compareCodePoints)(a.root_id, b.root_id)),
        corpus: {
            artifact_count: summary.artifact_count,
            archive_count: summary.archive_count,
            archive_member_count: summary.archive_member_count,
            root_count: summary.root_count,
            distinct_extension_count: extensions.size,
        },
        bytes_scanned: cold.scanned.bytes,
        files_scanned: cold.scanned.files,
        cache_hit_ratio_second_run: secondRunCache(warm.cacheStats),
        decoder_coverage: {
            text_decoder_id: corpus_scan_1.TEXT_DECODER_ID,
            text_decoder_version: corpus_scan_1.TEXT_DECODER_VERSION,
            normalized_document: coverage.normalized_document_coverage,
            interpretation: coverage.interpretation_coverage,
            lexical_analysis: coverage.lexical_analysis_coverage,
            embedding_when_enabled: coverage.embedding_coverage_when_enabled,
            embedding_enabled: coverage.embeddings.enabled,
        },
        duplicate_counts: {
            exact_duplicate_cluster_count: summary.exact_duplicate_cluster_count,
            exact_duplicate_artifact_count: summary.exact_duplicate_artifact_count,
            cross_root_duplicate_cluster_count: summary.cross_root_duplicate_cluster_count,
            recoverable_duplicate_bytes: summary.recoverable_duplicate_bytes,
            near_duplicate_candidate_count: summary.near_duplicate_candidate_count,
            cross_root_near_duplicate_count: summary.cross_root_near_duplicate_count,
            near_duplicate_threshold: profile.near_duplicate_threshold,
            unique_content_estimate: handoff.unique_content_estimate,
            unique_content_bytes_estimate: handoff.unique_content_bytes_estimate,
        },
        topic_candidate_counts: {
            candidate_count: summary.topic_candidate_count,
            cross_root_candidate_count: summary.cross_root_topic_candidate_count,
        },
        project_candidate_counts: {
            candidate_count: summary.project_candidate_count,
            cross_root_candidate_count: summary.cross_root_project_candidate_count,
        },
        reasoning_eligible_count: coverage.reasoning_handoff.reasoning_eligible_candidate_count,
        unsupported_counts: {
            unsupported_format_counts: unsupported,
            unsupported_format_total: unsupported.reduce((total, entry) => total + entry.count, 0),
            unsupported_format_bytes: unsupported.reduce((total, entry) => total + entry.bytes, 0),
            ocr_required_count: coverage.documents.ocr_required_count,
            encrypted_document_count: coverage.documents.encrypted_document_count,
            oversized_document_count: coverage.documents.oversized_document_count,
            secret_skipped_count: coverage.documents.secret_skipped_count,
        },
        cold_warm_equivalence: {
            semantic_output_identical: input.semanticOutputIdentical,
            corpus_snapshot_id_identical: cold.snapshot.corpus_source_snapshot_id === warm.snapshot.corpus_source_snapshot_id,
            cold_files_scanned: cold.scanned.files,
            warm_files_scanned: warm.scanned.files,
            cold_cache_hits: cold.cacheStats.hits,
            warm_cache_hits: warm.cacheStats.hits,
        },
        source_mutation: input.sourceMutation,
        no_priority_statement: exports.QUALIFICATION_NO_PRIORITY_STATEMENT,
    };
}
/** Canonical bytes of a qualification report. */
function renderCorpusQualificationReport(report) {
    return `${(0, corpus_analysis_1.canonicalCorpusJson)(report)}\n`;
}
//# sourceMappingURL=corpus_qualification.js.map