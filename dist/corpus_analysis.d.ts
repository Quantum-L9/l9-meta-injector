import { InventoryResult } from "./inventory";
import { InterpretationResult } from "./interpretation";
import { RepositoryModelPacket } from "./repository_model";
export declare const CORPUS_INDEX_SCHEMA = "l9.corpus-index/v1";
/**
 * Identity of the corpus analysis policy.
 *
 * Bound to the work extractor versions, both duplicate algorithms, and the
 * near-duplicate threshold, because changing any of them changes which
 * candidates and which signals the index reports.
 */
export declare const CORPUS_PROFILE_ID = "l9-meta-injector-corpus-intelligence";
export declare const CORPUS_PROFILE_VERSION = "1.0.0";
/** Exact duplicate detection: byte equality of known content hashes. */
export declare const EXACT_DUPLICATE_METHOD = "content-hash-equality/v1";
export declare const EXACT_DUPLICATE_METHOD_VERSION = "1.0.0";
/** Near-duplicate detection: Jaccard over unique 5-token shingles. */
export declare const NEAR_DUPLICATE_METHOD = "text-near-duplicate/v1";
export declare const NEAR_DUPLICATE_METHOD_VERSION = "1.0.0";
export declare const NEAR_DUPLICATE_SHINGLE_SIZE = 5;
/** Below this token count a shingle set is too small for the score to mean much. */
export declare const NEAR_DUPLICATE_MIN_TOKENS = 20;
export declare const DEFAULT_NEAR_DUPLICATE_THRESHOLD = 0.85;
/** Extensions whose text this analysis reads. Mirrors the work-intelligence profile. */
export declare const NEAR_DUPLICATE_EXTENSIONS: readonly string[];
/**
 * Deterministic JSON for the corpus index.
 *
 * The packet's `canonicalJson` refuses non-integer numbers, which is right for a
 * wire contract whose float formatting must not vary. The corpus index carries
 * similarity scores, so it needs its own renderer: keys in code-point order at
 * every depth, absent fields omitted rather than nulled, and every number finite
 * and already rounded by the producer.
 */
export declare function canonicalCorpusJson(value: unknown, indent?: number): string;
/**
 * Normalize text for similarity analysis only.
 *
 * The result is never written anywhere and never replaces the file's own content
 * hash: it exists so that two documents differing only in line endings, casing or
 * whitespace are recognized as lexically close. Lowercasing here is why the
 * analysis is explicitly lexical rather than semantic.
 */
export declare function normalizeForAnalysis(text: string): string;
/** Unicode word tokens of already-normalized text. */
export declare function analysisTokens(normalized: string): string[];
/** The unique 5-token shingles of a token stream, in insertion order. */
export declare function shingleSet(tokens: string[], size?: number): Set<string>;
export interface JaccardResult {
    score: number;
    shared: number;
    union: number;
}
/** Exact Jaccard similarity of two shingle sets. */
export declare function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): JaccardResult;
/** One document admitted to the similarity analysis. */
export interface NearDuplicateDocument {
    artifactId: string;
    sourcePath: string;
    /** Hash of the exact file bytes; equal hashes are exact duplicates, not candidates. */
    contentHash: string;
    /** Hash of the normalized analysis text, recorded so a score is reproducible. */
    normalizedContentHash: string;
    shingles: Set<string>;
    tokenCount: number;
}
/** Build the analysis view of one document's text. */
export declare function prepareNearDuplicateDocument(input: {
    artifactId: string;
    sourcePath: string;
    contentHash: string;
    text: string;
}): NearDuplicateDocument;
export interface NearDuplicateCandidate {
    candidate_id: string;
    artifact_a_id: string;
    artifact_b_id: string;
    source_path_a: string;
    source_path_b: string;
    method: string;
    algorithm_version: string;
    score: number;
    threshold: number;
    normalized_content_hash_a: string;
    normalized_content_hash_b: string;
    shared_shingle_count: number;
    union_shingle_count: number;
}
export declare function compareCandidates(left: NearDuplicateCandidate, right: NearDuplicateCandidate): number;
/**
 * Every qualifying pair, compared exhaustively.
 *
 * This is the definition the reported score means. It is quadratic in the corpus
 * size and is kept as the reference the indexed generator below is required to
 * match.
 */
export declare function nearDuplicateCandidatesExhaustive(documents: NearDuplicateDocument[], threshold: number): NearDuplicateCandidate[];
/**
 * The prefix of a shingle set that a qualifying partner must intersect.
 *
 * For Jaccard at threshold `t`, a pair can only reach `t` if it shares at least
 * `ceil(t * |X|)` shingles with the smaller of the two sets. Under any fixed
 * global order over shingles, two sets that share that many elements must both
 * contain one of the first `|X| - ceil(t * |X|) + 1` of them — otherwise the
 * shared elements would all have to sit past a point where fewer than that many
 * elements remain. So indexing only that prefix loses no qualifying pair.
 */
export declare function prefixLength(setSize: number, threshold: number): number;
/**
 * The same qualifying pairs, reached through a shingle index.
 *
 * Two exact filters do the work, and both are consequences of the definition of
 * Jaccard rather than approximations of it:
 *
 *   - a size bound: a set can share at most `min(|A|, |B|)` shingles, so a pair
 *     whose sizes differ by more than a factor of `t` cannot reach `t`;
 *   - a prefix bound: shingles are put in one global order — rarest first — and
 *     only each document's prefix is indexed, because a qualifying pair must
 *     intersect there.
 *
 * The tests hold this to the bounded all-pairs reference above at six thresholds.
 * Rarest-first matters for cost rather than correctness: it puts the shingles
 * every document in a corpus shares — a boilerplate heading, a licence block —
 * at the end of the order, where they are never indexed and so never generate a
 * candidate list the size of the corpus. At a threshold of zero every pair
 * qualifies by definition, and the exhaustive path is used instead.
 */
export declare function nearDuplicateCandidates(documents: NearDuplicateDocument[], threshold: number): NearDuplicateCandidate[];
/**
 * The acquisition facts the corpus index projects.
 *
 * Structural rather than an import of `LocalSourceObservation`, so analysis never
 * acquires a dependency on how a corpus was acquired.
 */
export interface CorpusAcquisition {
    sourceName: string;
    sourceRevision: string;
    physicalSnapshotHash: string;
    inventory: InventoryResult;
    archives: readonly {
        sourcePath: string;
        contentHash: string;
        sizeBytes: number;
        nestedDepth: number;
        expanded: boolean;
        memberCount: number;
        omittedMemberCount: number;
        holds: readonly {
            code: string;
        }[];
    }[];
    virtualArtifacts: readonly {
        virtualSourcePath: string;
        memberPath: string;
        contentHash: string;
        sizeBytes: number;
        parentArchivePath: string;
        parentArchiveHash: string;
        nestedDepth: number;
    }[];
    diagnostics: readonly {
        code: string;
        severity: string;
        message: string;
        sourcePath?: string;
    }[];
}
export interface NearDuplicateOptions {
    /** Skip the similarity pass entirely. Exact duplicates are unaffected. */
    enabled?: boolean;
    threshold?: number;
    /** Ceiling on the bytes read per document. Defaults to the interpretation limit. */
    maxFileBytes?: number;
}
export interface CorpusAnalysisInput {
    /** Semantic candidate discovery, when a caller has run it. */
    semantic?: CorpusSemanticProjection;
    acquisition: CorpusAcquisition;
    packet: RepositoryModelPacket;
    interpretation?: InterpretationResult;
    /**
     * Claims read out of decoded documents, keyed by nothing: each names its own
     * subject. Absent when no document format in the corpus had any.
     */
    blockSignals?: readonly CorpusBlockWorkSignal[];
    nearDuplicates?: NearDuplicateOptions;
}
export interface CorpusWorkSignal {
    assertion_id: string;
    artifact_id: string;
    predicate: string;
    object: string;
    source_path: string;
    /**
     * The line span, for a signal read out of a file that has lines.
     *
     * Absent for a signal read out of a decoded document, where `block_evidence`
     * below carries the coordinate instead. Optional rather than filled with a
     * placeholder span: `{start_line: 0, end_line: 0}` would be a location, and a
     * reader who followed it would find nothing there.
     */
    source_range?: {
        start_line: number;
        end_line: number;
    };
    /** The block coordinate, for a signal read out of a decoded document. */
    block_evidence?: {
        normalized_document_id: string | null;
        decoder_id: string;
        block_id: string;
        block_kind: string;
        locator: Record<string, unknown>;
    };
    extractor_id: string;
    evidence_class: string;
    confidence: string;
}
/**
 * A claim read out of a decoded document's blocks, as this projection needs it.
 *
 * Structurally the block-bound half of the work-signal vocabulary. Kept as its
 * own input rather than widened into `InterpretedAssertion`, because that type's
 * evidence is a line span and it is what the Repository Model Packet carries: a
 * `pptx_shape` locator has no meaning to a consumer promised line numbers.
 */
export interface CorpusBlockWorkSignal {
    assertion_id: string;
    subject_id: string;
    predicate: string;
    object: string;
    source_path: string;
    extractor_id: string;
    evidence_class: string;
    confidence: string;
    evidence: {
        normalized_document_id: string | null;
        decoder_id: string;
        block_id: string;
        block_kind: string;
        locator: Record<string, unknown>;
    };
}
export interface CorpusWorkSignalSummary {
    statuses: string[];
    kinds: string[];
    titles: string[];
    heading_count: number;
    open_task_count: number;
    completed_task_count: number;
    milestone_count: number;
    depends_on: string[];
    blocked_by: string[];
    references: string[];
    supersedes: string[];
    superseded_by: string[];
    signal_count: number;
}
export interface CorpusArtifact {
    artifact_id: string;
    source_path: string;
    artifact_type: string;
    content_hash: string;
    size_bytes: number | null;
    is_archive_member: boolean;
    assertion_ids: string[];
    work_signal_summary: CorpusWorkSignalSummary;
    exact_duplicate_cluster_id: string | null;
    near_duplicate_candidate_ids: string[];
    /** Empty when the semantic pass did not run; `index.semantic` says which. */
    topic_candidate_ids: string[];
    project_candidate_ids: string[];
    consolidation_candidate_ids: string[];
    reasoning_candidate_ids: string[];
}
export interface CorpusDuplicateCluster {
    cluster_id: string;
    content_hash: string;
    /**
     * A deterministic member chosen so a graph has a star centre to draw to.
     *
     * It is not a recommendation. Nothing here says the representative is the copy
     * to keep, the original, or the correct one — equivalence inside a cluster is
     * exact and symmetric, so every member is as authoritative as every other.
     */
    representative_artifact_id: string;
    representative_source_path: string;
    artifact_ids: string[];
    source_paths: string[];
    count: number;
    recoverable_bytes: number;
}
export interface CorpusRelation {
    relation_id: string;
    type: "DUPLICATE_OF";
    source_artifact_id: string;
    target_artifact_id: string;
    duplicate_cluster_id: string;
    content_hash: string;
    /** Exact byte equivalence holds in both directions and across the whole cluster. */
    symmetric: true;
}
export interface CorpusArchive {
    source_path: string;
    content_hash: string;
    size_bytes: number;
    nested_depth: number;
    expanded: boolean;
    member_count: number;
    omitted_member_count: number;
    hold_codes: string[];
}
export interface CorpusSummary {
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
export interface CorpusDiagnostics {
    packet: {
        code: string;
        severity: string;
        count: number;
    }[];
    interpretation: {
        code: string;
        severity: string;
        count: number;
    }[];
    /** Why an artifact was not eligible for the similarity pass. */
    near_duplicate_excluded: {
        reason: string;
        count: number;
    }[];
}
/**
 * The semantic pass's projection into the corpus index.
 *
 * Declared here as plain data rather than imported from `corpus_semantic_run`,
 * so the index does not depend on the analysis that fills it — the semantic
 * modules already import this one, and a return edge would close a cycle.
 *
 * Null on the index means the pass did not run. That is deliberately different
 * from zeros: "no candidates were found" and "nobody looked" are not the same
 * statement about a corpus.
 */
export interface CorpusSemanticProjection {
    semantic_analysis_profile_id: string;
    semantic_analysis_profile_version: string;
    keyphrase_profile: string;
    semantic_fusion_profile: string;
    reasoning_routing_profile: string;
    embedding_enabled: boolean;
    embedding_provider_when_enabled: string | null;
    embedding_model_when_enabled: string | null;
    embedding_model_revision_when_available: string | null;
    semantic_pair_count: number;
    topic_candidate_count: number;
    project_candidate_count: number;
    consolidation_candidate_count: number;
    reasoning_eligible_count: number;
    embedding_eligible_artifact_count: number;
    embedded_artifact_count: number;
    /** Candidate ids per artifact id, for the per-artifact rows below. */
    candidate_ids_by_artifact: Record<string, {
        topic_candidate_ids: string[];
        project_candidate_ids: string[];
        consolidation_candidate_ids: string[];
        reasoning_candidate_ids: string[];
    }>;
    /** Restated so a reader of the index alone sees the boundary. */
    candidate_statement: string;
}
export interface CorpusIndex {
    schema: string;
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
        corpus_profile_hash: string;
        exact_duplicate_method: string;
        exact_duplicate_version: string;
        near_duplicate_method: string;
        near_duplicate_version: string;
        near_duplicate_threshold: number;
        near_duplicate_enabled: boolean;
    };
    summary: CorpusSummary;
    artifacts: CorpusArtifact[];
    work_signals: CorpusWorkSignal[];
    exact_duplicate_clusters: CorpusDuplicateCluster[];
    relations: CorpusRelation[];
    near_duplicate_candidates: NearDuplicateCandidate[];
    archives: CorpusArchive[];
    diagnostics: CorpusDiagnostics;
    /** Semantic candidate discovery, or null when the pass did not run. */
    semantic: CorpusSemanticProjection | null;
}
/** Predicates the corpus index treats as work intelligence. */
export declare const CORPUS_WORK_PREDICATES: readonly string[];
/**
 * The member a rendering draws toward: shortest source path, then code point.
 *
 * Shared by both clusterers so "representative" has one definition. It is a
 * drawing convenience and nothing else — every member of an exact cluster is
 * byte-equal to every other, so no member is the original, the canonical copy or
 * the one to keep.
 */
export declare function duplicateRepresentative<T extends {
    sourcePath: string;
}>(members: readonly T[]): T;
/** Total order over clusters: most recoverable bytes, then size, then id. */
export declare function compareDuplicateClusters(left: CorpusDuplicateCluster, right: CorpusDuplicateCluster): number;
/** One artifact's contribution to exact-duplicate clustering. */
export interface ExactDuplicateInput {
    artifactId: string;
    sourcePath: string;
    contentHash: string;
    sizeBytes: number | null;
}
/**
 * Cluster artifacts by byte equality, over any artifact set.
 *
 * The corpus-scope counterpart of `buildCorpusDuplicateClusters`: same rule —
 * equal known content hashes, two or more members — reached from a flat artifact
 * list rather than from one repository's inventory, so a cluster can span roots,
 * disks and archives.
 */
export declare function clusterExactDuplicates(artifacts: readonly ExactDuplicateInput[]): CorpusDuplicateCluster[];
/**
 * Project the canonical duplicate clusters onto artifact identity.
 *
 * Membership is decided by the acquisition clustering, which is byte equality.
 * All this adds is the artifact each path resolves to and the deterministic
 * representative a star rendering needs.
 */
export declare function buildCorpusDuplicateClusters(inventory: InventoryResult, repositoryId: string, emittedArtifactIds: ReadonlySet<string>): CorpusDuplicateCluster[];
/**
 * One relation per non-representative member.
 *
 * A cluster of n members has n(n-1)/2 equivalent pairs; rendering them all would
 * drown a graph in edges that say the same thing. Each member points at the
 * representative instead, and every relation carries the cluster id so a consumer
 * can see that the equivalence is cluster-wide and symmetric rather than a
 * hub-and-spoke claim.
 */
export declare function buildDuplicateRelations(clusters: readonly CorpusDuplicateCluster[]): CorpusRelation[];
/**
 * Build the corpus index from an acquisition, its packet, and its interpretation.
 *
 * The index resolves every artifact it names against the packet, so a reference
 * that does not resolve cannot be emitted. Where the packet has no artifact for
 * something acquisition saw, the index simply has nothing to say about it.
 */
export declare function buildCorpusIndex(input: CorpusAnalysisInput): CorpusIndex;
/**
 * Attach a semantic projection to an already-built index.
 *
 * A pure transformation, and the reason this module does not import the semantic
 * analysis: the semantic modules already import this one, so a call in the other
 * direction would close a cycle. The caller runs the pass and hands the result
 * back here.
 */
export declare function withSemanticProjection(index: CorpusIndex, semantic: CorpusSemanticProjection): CorpusIndex;
/** Serialize an index to the bytes written as `corpus-index.json`. */
export declare function renderCorpusIndex(index: CorpusIndex): string;
