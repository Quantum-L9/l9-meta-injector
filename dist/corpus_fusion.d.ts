import type { EvidenceFamily, PairSignalKind, SemanticPair } from "./corpus_pairs";
import type { ArtifactFeatureView } from "./corpus_semantics";
export declare const FUSION_PROFILE_ID = "semantic-fusion/v1";
export declare const FUSION_PROFILE_VERSION = "1.0.0";
export declare const TOPIC_CANDIDATE_SCHEMA = "l9.topic-candidates/v1";
export declare const PROJECT_CANDIDATE_SCHEMA = "l9.project-candidates/v1";
export declare const CONSOLIDATION_CANDIDATE_SCHEMA = "l9.consolidation-candidates/v1";
export declare const SEMANTIC_RELATIONS_SCHEMA = "l9.semantic-relations/v1";
/**
 * Score at or above which a graded signal counts as *strongly* supporting.
 *
 * Stated once, here, and bound into the profile hash. The contract's warning
 * against tuning thresholds until fixtures pass is the reason these are constants
 * rather than parameters: a threshold that moves to fit the corpus is a
 * description of the corpus.
 */
export declare const STRONG_SIGNAL_THRESHOLDS: Readonly<Partial<Record<PairSignalKind, number>>>;
/** Default cosine at which an embedding pair is *offered* at all. */
export declare const DEFAULT_EMBEDDING_PAIR_THRESHOLD = 0.75;
/** Default cosine at which an embedding signal counts as strong. */
export declare const DEFAULT_EMBEDDING_STRONG_THRESHOLD = 0.85;
export type ConfidenceClass = "weak" | "moderate" | "strong";
export interface FusionOptions {
    embeddingStrongThreshold?: number;
}
export declare function fusionProfileHash(options?: FusionOptions): string;
export interface PairClassification {
    pair_id: string;
    artifact_a_id: string;
    artifact_b_id: string;
    confidence_class: ConfidenceClass;
    /** Families present, context excluded. Context corroborates nothing. */
    supporting_families: EvidenceFamily[];
    strong_families: EvidenceFamily[];
    family_counts: Record<EvidenceFamily, number>;
    has_exact_duplicate: boolean;
    /** True when the only non-context signal is an embedding score. */
    embedding_only: boolean;
    /** True when nothing but shared archive ancestry was found. */
    context_only: boolean;
}
/**
 * Classify one pair.
 *
 * `context_only` pairs get a classification so the accounting stays complete, but
 * every candidate builder below refuses them: a shared folder is where two files
 * are, not what they are about.
 */
export declare function classifyPair(pair: SemanticPair, options?: FusionOptions): PairClassification;
export interface CandidateAnalysisProfile {
    fusion_profile_id: string;
    fusion_profile_version: string;
    fusion_profile_hash: string;
}
export interface TopicCandidate {
    candidate_id: string;
    candidate_type: "TOPIC_CANDIDATE";
    member_artifact_ids: string[];
    supporting_pair_ids: string[];
    evidence_family_counts: Record<EvidenceFamily, number>;
    lexical_signal_count: number;
    semantic_signal_count: number;
    explicit_reference_count: number;
    cross_archive: boolean;
    confidence_class: ConfidenceClass;
    ambiguity_class: string[];
    representative_keyphrases: string[];
    analysis_profile: CandidateAnalysisProfile;
}
export interface ProjectCandidate {
    candidate_id: string;
    candidate_type: "PROJECT_CANDIDATE";
    member_artifact_ids: string[];
    supporting_pair_ids: string[];
    declared_identifiers: string[];
    explicit_reference_count: number;
    dependency_signal_count: number;
    duplicate_cluster_count: number;
    near_duplicate_count: number;
    work_statuses: string[];
    work_kinds: string[];
    open_task_count: number;
    milestone_count: number;
    cross_archive: boolean;
    confidence_class: ConfidenceClass;
    ambiguity_class: string[];
    analysis_profile: CandidateAnalysisProfile;
}
export interface ConsolidationCandidate {
    candidate_id: string;
    candidate_type: "CONSOLIDATION_CANDIDATE";
    member_artifact_ids: string[];
    exact_duplicate_cluster_ids: string[];
    near_duplicate_candidate_ids: string[];
    supersession_assertion_ids: string[];
    project_candidate_ids: string[];
    cross_archive: boolean;
    content_hash_count: number;
    /** Distinct content hashes: 1 means every member is byte-identical. */
    unique_content_variant_count: number;
    work_statuses: string[];
    ambiguity_flags: string[];
    evidence_refs: string[];
    /** What admitted this candidate, so the reasoning router can read it. */
    evidence_class: string;
    analysis_profile: CandidateAnalysisProfile;
}
export declare const AMBIGUITY_CONFLICTING_STATUS = "conflicting_status";
export declare const AMBIGUITY_MULTIPLE_PROJECT_NAMES = "multiple_declared_project_names";
export declare const AMBIGUITY_AMBIGUOUS_SUPERSESSION = "ambiguous_supersession";
export declare const AMBIGUITY_MIXED_VERSION_LINEAGE = "mixed_version_lineage";
export declare const AMBIGUITY_WEAKLY_CONNECTED = "weakly_connected_members";
export interface BuildCandidatesInput {
    views: readonly ArtifactFeatureView[];
    pairs: readonly SemanticPair[];
    options?: FusionOptions;
}
/**
 * Topic candidates: connected components over corroborated edges.
 *
 * Only moderate and strong edges are admitted. A weak edge — one lexical metric,
 * or an embedding score on its own — is exactly the kind that chains unrelated
 * documents into one enormous component, which is the failure mode that makes
 * clustering output useless rather than merely wrong.
 */
export declare function buildTopicCandidates(input: BuildCandidatesInput): TopicCandidate[];
/**
 * Whether an edge may join two artifacts into one body of work.
 *
 * Stricter than topic admission, and the strictness is the contract: declared
 * identity, an explicit graph edge, or similarity corroborated across two
 * independent families of which one is declared identity, graph or lexical. An
 * embedding score never qualifies on its own, and neither does a shared archive.
 */
export declare function isProjectEligibleEdge(entry: PairClassification): boolean;
export declare function buildProjectCandidates(input: BuildCandidatesInput): ProjectCandidate[];
export declare const CONSOLIDATION_EVIDENCE_EXACT_DUPLICATE = "exact_duplicate_cluster";
export declare const CONSOLIDATION_EVIDENCE_NEAR_DUPLICATE = "near_duplicate_relation";
export declare const CONSOLIDATION_EVIDENCE_SUPERSESSION = "explicit_supersession";
export declare const CONSOLIDATION_EVIDENCE_PROJECT_VERSIONS = "project_candidate_with_multiple_versions";
export interface BuildConsolidationInput extends BuildCandidatesInput {
    projectCandidates: readonly ProjectCandidate[];
}
/**
 * Consolidation candidates: groups worth looking at together.
 *
 * Admission is deliberately mechanical — a duplicate cluster, a near-duplicate
 * edge, a declared supersession, or a project candidate holding several content
 * variants. The record carries `unique_content_variant_count` because it is the
 * number that decides whether a human needs to read anything: a group whose
 * members are all byte-identical has one variant and nothing to adjudicate.
 */
export declare function buildConsolidationCandidates(input: BuildConsolidationInput): ConsolidationCandidate[];
