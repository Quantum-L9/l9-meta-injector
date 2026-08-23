export declare const CORPUS_COVERAGE_SCHEMA = "l9.corpus-coverage/v1";
/** Raster formats that carry no extractable text layer without OCR. */
export declare const OCR_REQUIRED_EXTENSIONS: readonly string[];
/**
 * Text-bearing formats this release does not decode.
 *
 * Listed rather than inferred, so the gap is a stated set an operator can read
 * off the report and a future decoder can be measured against.
 */
export declare const UNDECODED_DOCUMENT_EXTENSIONS: readonly string[];
export interface CoverageRatio {
    /** Artifacts the analysis could apply to at all. */
    eligible: number;
    /** Of those, the ones it did apply to. */
    covered: number;
    /** `covered / eligible`, six places. `1` when nothing was eligible. */
    ratio: number;
}
export interface FormatCount {
    extension: string;
    count: number;
    bytes: number;
}
export interface ReasoningHandoff {
    /** Where the readiness signals for this corpus live. */
    readiness_evidence_refs: {
        schema: string;
        file: string;
        body_of_work_count: number;
        signal_vocabulary: readonly string[];
    };
    /** Declared dependency and blocker assertions, by predicate. */
    dependency_evidence_refs: {
        predicate: string;
        assertion_count: number;
    }[];
    /** Exact clusters and lexical candidates, kept in their separate classes. */
    duplicate_evidence_refs: {
        exact_duplicate_cluster_count: number;
        exact_duplicate_artifact_count: number;
        recoverable_duplicate_bytes: number;
        near_duplicate_candidate_count: number;
        near_duplicate_threshold: number;
    };
    /** Distinct content hashes in the corpus; exact duplicates collapse to one. */
    unique_content_estimate: number;
    unique_content_bytes_estimate: number;
    /** Restated so a consumer reading only this file sees the boundary. */
    no_priority_statement: string;
}
export declare const NO_PRIORITY_STATEMENT: string;
export interface CorpusCoverage {
    schema: string;
    corpus_source_snapshot_id: string;
    corpus_analysis_id: string;
    root_ids: string[];
    total_files: number;
    total_bytes: number;
    archive_count: number;
    archive_member_count: number;
    exact_hash_coverage: CoverageRatio;
    normalized_document_coverage: CoverageRatio;
    interpretation_coverage: CoverageRatio;
    lexical_analysis_coverage: CoverageRatio;
    /** Null when embeddings were not enabled, which is the default. */
    embedding_coverage_when_enabled: CoverageRatio | null;
    embedding_enabled: boolean;
    unsupported_format_counts: FormatCount[];
    ocr_required_count: number;
    encrypted_document_count: number;
    oversized_document_count: number;
    secret_skipped_count: number;
    project_candidate_count: number;
    topic_candidate_count: number;
    reasoning_eligible_candidate_count: number;
    reasoning_handoff: ReasoningHandoff;
    /** Every cache layer's hit accounting, so a reported ratio can be checked. */
    cache: {
        enabled: boolean;
        hit_ratio: number;
        hits: number;
        misses: number;
        writes: number;
        corrupt: number;
        layers: {
            layer: string;
            hits: number;
            misses: number;
            writes: number;
            corrupt: number;
        }[];
    };
}
/** Build a ratio, treating "nothing was eligible" as complete coverage. */
export declare function coverageRatio(covered: number, eligible: number): CoverageRatio;
/** Group counts and bytes by extension, in code-point order. */
export declare function formatCounts(entries: readonly {
    extension: string;
    bytes: number;
}[]): FormatCount[];
/** Canonical bytes of a coverage report. */
export declare function renderCorpusCoverage(coverage: CorpusCoverage): string;
