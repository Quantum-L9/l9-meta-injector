import { LocalSourceObservation } from "./local_source";
import { RepositoryModelPacket } from "./repository_model";
export declare const CORPUS_INDEX_SCHEMA = "l9.corpus-index/v1";
/** Identity of the corpus analysis policy as a whole. */
export declare const CORPUS_PROFILE_ID = "l9-meta-injector-corpus-intelligence";
export declare const CORPUS_PROFILE_VERSION = "1.0.0";
/** Identity of the near-duplicate algorithm specifically. */
export declare const NEAR_DUPLICATE_METHOD = "text-near-duplicate/v1";
export declare const NEAR_DUPLICATE_VERSION = "1.0.0";
export declare const DEFAULT_NEAR_DUPLICATE_THRESHOLD = 0.85;
/** Shingle width, in tokens. Part of the algorithm's identity. */
export declare const NEAR_DUPLICATE_SHINGLE_SIZE = 5;
/** Below this many tokens a document is too short for the score to mean anything. */
export declare const NEAR_DUPLICATE_MIN_TOKENS = 20;
/** Bytes above which a document is not analysed for similarity. */
export declare const NEAR_DUPLICATE_MAX_BYTES: number;
export interface CorpusDuplicateCluster {
    /** `duplicate-cluster:sha256:<content-hash>` — identity is the content, not a path. */
    cluster_id: string;
    content_hash: string;
    /**
     * A deterministic star target for rendering, chosen by shortest path then code
     * point. It is NOT a recommendation about which copy to keep: this analysis has
     * no opinion about that and the data to form one is not in scope.
     */
    representative_artifact_id: string;
    representative_source_path: string;
    artifact_ids: string[];
    source_paths: string[];
    count: number;
    /** Bytes that would be released if the cluster held one copy. Not advice to do so. */
    recoverable_bytes: number;
}
export interface CorpusDuplicateRelation {
    relation_id: string;
    type: "DUPLICATE_OF";
    source_artifact_id: string;
    target_artifact_id: string;
    duplicate_cluster_id: string;
    content_hash: string;
    /** Byte equality is symmetric; the star rendering is a layout, not a direction. */
    symmetric: true;
}
export interface CorpusNearDuplicateCandidate {
    candidate_id: string;
    artifact_a_id: string;
    artifact_b_id: string;
    source_path_a: string;
    source_path_b: string;
    method: string;
    algorithm_version: string;
    /** Exact Jaccard over unique token shingles, rounded to 6 decimal places. */
    score: number;
    threshold: number;
    normalized_content_hash_a: string;
    normalized_content_hash_b: string;
    shared_shingle_count: number;
    union_shingle_count: number;
}
export interface CorpusWorkSignal {
    assertion_id: string;
    artifact_id: string;
    predicate: string;
    object: string;
    source_path: string;
    source_range: {
        start_line: number;
        end_line: number;
    };
    extractor_id: string;
    evidence_class: string;
    confidence: string;
}
export interface CorpusArtifactEntry {
    artifact_id: string;
    source_path: string;
    artifact_type: string;
    content_hash: string | null;
    size_bytes: number | null;
    is_archive_member: boolean;
    assertion_ids: string[];
    work_signal_summary: Record<string, number>;
    exact_duplicate_cluster_id: string | null;
    near_duplicate_candidate_ids: string[];
}
export interface CorpusIndexSummary {
    artifact_count: number;
    archive_count: number;
    archive_member_count: number;
    interpreted_artifact_count: number;
    assertion_count: number;
    artifacts_with_work_signals: number;
    exact_duplicate_cluster_count: number;
    exact_duplicate_artifact_count: number;
    recoverable_duplicate_bytes: number;
    near_duplicate_candidate_count: number;
    open_task_count: number;
    completed_task_count: number;
    milestone_count: number;
    wip_count: number;
    draft_count: number;
    blocked_count: number;
    roadmap_count: number;
    plan_count: number;
}
export interface CorpusIndex {
    schema: typeof CORPUS_INDEX_SCHEMA;
    source: {
        source_name: string;
        source_revision: string;
        physical_snapshot_hash: string;
    };
    repository_model: {
        packet_id: string;
        semantic_hash: string;
        packet_version: string;
        interpretation_profile: {
            profile_id: string;
            profile_version: string;
            profile_hash: string;
        } | null;
    };
    analysis_profile: {
        corpus_profile_id: string;
        corpus_profile_version: string;
        near_duplicate_method: string;
        near_duplicate_version: string;
        near_duplicate_threshold: number;
        near_duplicate_analysed: boolean;
    };
    summary: CorpusIndexSummary;
    artifacts: CorpusArtifactEntry[];
    work_signals: CorpusWorkSignal[];
    exact_duplicate_clusters: CorpusDuplicateCluster[];
    relations: CorpusDuplicateRelation[];
    near_duplicate_candidates: CorpusNearDuplicateCandidate[];
    diagnostics: {
        code: string;
        severity: string;
        message: string;
        source_path?: string;
    }[];
}
/**
 * The exact normalization the similarity score is defined over.
 *
 * Every step is lossy on purpose, and every step is part of the algorithm's
 * identity: changing any of them changes what a score means, which is why the
 * method carries a version.
 */
export declare function normalizeForSimilarity(text: string): string;
/** Unicode word tokens of the normalized text. */
export declare function tokenize(normalized: string): string[];
/** Unique k-token shingles. The set, not the sequence: order is not scored. */
export declare function shingleSet(tokens: string[], size?: number): Set<string>;
/** Exact Jaccard over two shingle sets. Two empty sets are unknown, not identical. */
export declare function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number;
export interface CorpusAnalysisInput {
    observation: LocalSourceObservation;
    packet: RepositoryModelPacket;
    /** Repository name the packet was built with; artifact IDs derive from it. */
    repositoryName: string;
    /** Similarity threshold in [0,1]. Participates in analysis identity. */
    nearDuplicateThreshold?: number;
    /** Skip similarity analysis entirely. Exact duplicates are still reported. */
    skipNearDuplicates?: boolean;
}
interface AnalysableDocument {
    artifactId: string;
    sourcePath: string;
    normalizedHash: string;
    shingles: Set<string>;
}
/**
 * Project acquisition's content-hash clusters onto artifact identity.
 *
 * The clustering itself already happened during acquisition, over the unified
 * record set. This adds artifact IDs, a cluster identity derived from the content
 * hash, and the star relations the index renders.
 */
export declare function buildDuplicateProjection(observation: LocalSourceObservation, repositoryId: string): {
    clusters: CorpusDuplicateCluster[];
    relations: CorpusDuplicateRelation[];
};
/**
 * The reference scorer: every pair, scored exactly.
 *
 * Quadratic and therefore not the production path, but it is the definition of
 * the result the production path must reproduce. Tests run both over the same
 * corpora and require identical output.
 */
export declare function referenceNearDuplicates(documents: AnalysableDocument[], threshold: number): CorpusNearDuplicateCandidate[];
/**
 * Candidate generation via a shingle index.
 *
 * Two documents can only reach the threshold if they share at least one shingle,
 * so only pairs that co-occur in some shingle's posting list are scored. Every
 * surviving pair is then scored exactly, by the same function the reference uses,
 * so this is a way of skipping pairs that cannot qualify — not an approximation.
 */
export declare function indexedNearDuplicates(documents: AnalysableDocument[], threshold: number): CorpusNearDuplicateCandidate[];
/**
 * Assemble the corpus index.
 *
 * Every field is copied from the observation, the packet, or one of the two
 * analyses. Nothing is recomputed from source bytes here, so the index cannot
 * disagree with the packet it cites.
 */
export declare function buildCorpusIndex(input: CorpusAnalysisInput): CorpusIndex;
/**
 * The analysis identity a corpus index was produced under.
 *
 * The threshold is part of it: the same corpus analysed at 0.85 and at 0.6 is the
 * same evidence under two different questions, and the answers should not be
 * confused for one another.
 */
export declare function corpusAnalysisIdentity(threshold: number): string;
/**
 * Canonical JSON for a corpus index.
 *
 * The packet canonicalizer is deliberately integer-only: the Repository Model
 * wire contract forbids floats so two runtimes can never disagree about a
 * decimal's representation. A similarity score is genuinely fractional, so the
 * corpus index cannot use that serializer and needs its own rule instead of
 * loosening the wire one.
 *
 * Determinism here comes from two things: keys are ordered by code point, and
 * every score is rounded to a fixed precision before it is stored, so the
 * shortest round-trip representation JavaScript emits is stable rather than
 * accidental.
 */
export declare function canonicalCorpusJson(value: unknown): string;
/**
 * Content identity for corpus values, over the corpus canonical form.
 *
 * Separate from the packet's `semanticHash` for the same reason
 * `canonicalCorpusJson` is separate from `canonicalJson`: corpus identity has to
 * cover a fractional threshold, and the packet's hash refuses floats on purpose.
 */
export declare function corpusSemanticHash(value: unknown): string;
export declare function corpusStableId(prefix: string, value: unknown): string;
export type { AnalysableDocument };
