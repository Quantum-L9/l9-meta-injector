import type { CorpusCoverage } from "./corpus_coverage";
import type { CorpusDocumentSignals } from "./corpus_document_signals";
import type { CorpusSnapshot } from "./corpus_snapshot";
export declare const CORPUS_INDEX_SCHEMA = "l9.corpus-index/v1";
/** One root, as the index points at it. */
export interface CorpusIndexRoot {
    root_id: string;
    root_key: string;
    source_kind: string;
    source_revision: string;
    rmp_packet_id: string;
    rmp_semantic_hash: string;
    bundle_ref: string | null;
    document_index_ref: string | null;
    document_coverage_ref: string | null;
    acquisition_manifest_ref: string | null;
    observation_status: string;
    failure_reason: string | null;
    artifact_count: number;
    archive_count: number;
    total_bytes: number;
}
/** A document this run wrote, named so a consumer does not have to guess. */
export interface CorpusIndexArtifactRef {
    name: string;
    path: string;
    schema: string | null;
    present: boolean;
}
export interface CorpusIndex {
    schema: string;
    corpus_id: string;
    corpus_source_snapshot_id: string;
    corpus_analysis_id: string;
    corpus_status: string;
    roots: CorpusIndexRoot[];
    missing_root_ids: string[];
    counts: CorpusSnapshot["counts"];
    documents: CorpusIndexArtifactRef[];
    /**
     * What was understood, and what was not.
     *
     * Present so the report an operator reads can answer the question the corpus
     * exists to answer — "we inspected this and found nothing" against "we could
     * not understand this" — without their having to open two JSON files and join
     * them by hand. Optional because an index can be built from a snapshot alone,
     * and a coverage section invented from one would be a fabrication.
     */
    coverage?: CorpusIndexCoverage;
    statement: string;
}
/** Every count the coverage law requires the report to state. */
export interface CorpusIndexCoverage {
    hashed_artifact_count: number;
    unhashed_artifact_count: number;
    /** Per format: eligible, decoded, and the refusals, by the decoder's reason. */
    decoding: {
        format: string;
        decoder_id: string;
        eligible_count: number;
        decoded_count: number;
        interpreted_count: number;
        refusals: {
            name: string;
            count: number;
        }[];
    }[];
    ocr_required_count: number;
    encrypted_count: number;
    unsupported_legacy_counts: {
        extension: string;
        count: number;
        bytes: number;
    }[];
    decoder_failure_count: number;
    intelligence: {
        artifacts_with_work_signals: number;
        exact_duplicate_clusters: number;
        near_duplicate_candidates: number;
        topic_candidates: number;
        project_candidates: number;
        consolidation_candidates: number;
        reasoning_eligible_candidates: number;
    };
    embedding: {
        enabled: boolean;
        eligible_artifacts: number | null;
        embedded_artifacts: number | null;
        skipped_secret_artifacts: number | null;
        provider_failures: number | null;
    };
}
export declare const CORPUS_INDEX_STATEMENT: string;
export interface BuildCorpusIndexInput {
    snapshot: CorpusSnapshot;
    /** Root-directory name for each root id, as written under `roots/`. */
    rootDirectories: ReadonlyMap<string, string>;
    /** Output-relative paths this run actually wrote. */
    writtenPaths: readonly string[];
    /** The coverage document and the document signals, joined into the report. */
    coverage?: CorpusCoverage;
    documentSignals?: CorpusDocumentSignals;
}
export declare function buildCorpusIndex(input: BuildCorpusIndexInput): CorpusIndex;
/** Canonical bytes of the index. */
export declare function renderCorpusIndex(index: CorpusIndex): string;
/** The same index, rendered for a person. */
export declare function renderCorpusIndexReport(index: CorpusIndex): string;
