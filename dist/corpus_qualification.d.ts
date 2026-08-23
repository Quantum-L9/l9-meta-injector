import type { CoverageRatio, FormatCount } from "./corpus_coverage";
import type { CorpusScanResult } from "./corpus_scan";
/** Schema of the real-corpus qualification report. */
export declare const CORPUS_QUALIFICATION_SCHEMA = "l9.corpus-qualification-report/v1";
/** One root, named by identity alone. */
export interface QualificationRoot {
    root_id: string;
    root_label: string;
    root_snapshot_id: string;
    source_kind: string;
    source_revision: string;
}
/** What the decoders opened, and under which decoder identity. */
export interface DecoderCoverage {
    text_decoder_id: string;
    text_decoder_version: string;
    normalized_document: CoverageRatio;
    interpretation: CoverageRatio;
    lexical_analysis: CoverageRatio;
    embedding_when_enabled: CoverageRatio | null;
    embedding_enabled: boolean;
}
/** Byte equality, kept apart from wording similarity. */
export interface DuplicateCounts {
    exact_duplicate_cluster_count: number;
    exact_duplicate_artifact_count: number;
    cross_root_duplicate_cluster_count: number;
    recoverable_duplicate_bytes: number;
    near_duplicate_candidate_count: number;
    cross_root_near_duplicate_count: number;
    near_duplicate_threshold: number;
    unique_content_estimate: number;
    unique_content_bytes_estimate: number;
}
export interface CandidateCounts {
    candidate_count: number;
    cross_root_candidate_count: number;
}
/** Everything the run could not read, by the reason it could not read it. */
export interface UnsupportedCounts {
    unsupported_format_counts: FormatCount[];
    unsupported_format_total: number;
    unsupported_format_bytes: number;
    ocr_required_count: number;
    encrypted_document_count: number;
    oversized_document_count: number;
    secret_skipped_count: number;
}
/** The second run's own cache accounting, never averaged with the first run's. */
export interface SecondRunCacheHitRatio {
    enabled: boolean;
    hit_ratio: number;
    hits: number;
    misses: number;
    writes: number;
    corrupt: number;
    stale_producer: number;
    layers: {
        layer: string;
        hits: number;
        misses: number;
        writes: number;
        corrupt: number;
    }[];
}
/**
 * Whether the warm run said the same thing as the cold one.
 *
 * `semantic_output_identical` is the invariant the cache is only allowed to exist
 * under: a hit and a miss must produce the same bytes for the deterministic
 * projections. The caller computes it by comparing rendered output, because this
 * module must not be the thing that decides its own qualification passed.
 */
export interface ColdWarmEquivalence {
    semantic_output_identical: boolean;
    corpus_snapshot_id_identical: boolean;
    cold_files_scanned: number;
    warm_files_scanned: number;
    cold_cache_hits: number;
    warm_cache_hits: number;
}
/**
 * Proof that reading a corpus left it exactly as it was found.
 *
 * The digests are the proof; the mode bits are only an attempt at one. A process
 * running as root writes through `0o444` without noticing it, so the fixture
 * records whether the read-only mode was *applied* and, separately, whether it is
 * actually *enforced* against this process. Reporting a single "read only" flag
 * would state a guarantee that the second field exists to deny.
 */
export interface SourceMutationProof {
    /** Digest over every path, mode and content in the fixture, before the runs. */
    tree_digest_before: string;
    /** The same digest taken after the last run. */
    tree_digest_after: string;
    /** Paths whose content, kind or presence changed. The contract's target is zero. */
    mutated_path_count: number;
    /** True when every file was chmod'ed read-only and every directory non-writable. */
    read_only_mode_applied: boolean;
    /** True only when a probe write into the fixture actually failed. */
    read_only_enforced_for_process: boolean;
}
/** One root's own Repository Model Packet, as the report cites it. */
export interface QualificationRootPacket {
    root_label: string;
    rmp_packet_id: string;
    rmp_semantic_hash: string;
    bundle_ref: string | null;
    observation_status: string;
}
/** How this run established its hashes, and what may be claimed of them. */
export interface QualificationVerification {
    mode: string;
    verification_class: string;
    fully_rehashed_artifact_count: number;
    cached_hash_reuse_count: number;
    unhashed_artifact_count: number;
}
export interface CorpusQualificationReport {
    schema: string;
    corpus_id: string;
    corpus_snapshot_id: string;
    corpus_analysis_id: string;
    corpus_status: string;
    missing_root_ids: string[];
    verification: QualificationVerification;
    /** One packet per observed root: the corpus never replaced them with one tree. */
    root_packets: QualificationRootPacket[];
    corpus_profile_hash: string;
    producer_version: string;
    roots: QualificationRoot[];
    corpus: {
        artifact_count: number;
        archive_count: number;
        archive_member_count: number;
        root_count: number;
        distinct_extension_count: number;
    };
    bytes_scanned: number;
    files_scanned: number;
    cache_hit_ratio_second_run: SecondRunCacheHitRatio;
    decoder_coverage: DecoderCoverage;
    duplicate_counts: DuplicateCounts;
    topic_candidate_counts: CandidateCounts;
    project_candidate_counts: CandidateCounts;
    reasoning_eligible_count: number;
    unsupported_counts: UnsupportedCounts;
    cold_warm_equivalence: ColdWarmEquivalence;
    source_mutation: SourceMutationProof;
    /** Restated so a consumer reading only this file sees the boundary. */
    no_priority_statement: string;
}
export declare const QUALIFICATION_NO_PRIORITY_STATEMENT: string;
export interface CorpusQualificationInput {
    /** The run made with an empty cache. */
    cold: CorpusScanResult;
    /** The run made immediately afterwards against the same bytes and a warm cache. */
    warm: CorpusScanResult;
    producerVersion: string;
    /** Decided by the caller comparing rendered projections, not by this module. */
    semanticOutputIdentical: boolean;
    sourceMutation: SourceMutationProof;
}
/**
 * Build the report from a cold run, the warm run that followed it, and the
 * caller's own comparison of the two.
 *
 * The measurements come from the cold run, because that is the run that read the
 * corpus. The cache ratio comes from the warm run, because that is the run the
 * ratio is a fact about.
 */
export declare function buildCorpusQualificationReport(input: CorpusQualificationInput): CorpusQualificationReport;
/** Canonical bytes of a qualification report. */
export declare function renderCorpusQualificationReport(report: CorpusQualificationReport): string;
