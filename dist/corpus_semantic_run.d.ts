import type { ConsolidationCandidate, FusionOptions, PairClassification, ProjectCandidate, TopicCandidate } from "./corpus_fusion";
import type { EmbeddingPairScore, PairGenerationDiagnostic, SemanticPair } from "./corpus_pairs";
import type { ArtifactFeatureView, SemanticArtifactInput } from "./corpus_semantics";
import type { PackAssertion, ReasoningCandidate, ReasoningEvidencePack, ReasoningPackBudget } from "./corpus_reasoning";
import type { EmbeddingRunReport } from "./corpus_embeddings";
export declare const SEMANTIC_ANALYSIS_PROFILE_ID = "corpus-semantic-analysis/v1";
export declare const SEMANTIC_ANALYSIS_PROFILE_VERSION = "1.0.0";
/** Every profile that decides what this pass emits, recorded in one place. */
export interface SemanticAnalysisProfile {
    semantic_analysis_profile_id: string;
    semantic_analysis_profile_version: string;
    keyphrase_profile: string;
    keyphrase_profile_hash: string;
    pair_signal_profile: string;
    pair_signal_profile_hash: string;
    semantic_fusion_profile: string;
    semantic_fusion_profile_hash: string;
    reasoning_routing_profile: string;
    reasoning_routing_profile_hash: string;
    embedding_enabled: boolean;
    embedding_provider_when_enabled: string | null;
    embedding_model_when_enabled: string | null;
    embedding_model_revision_when_available: string | null;
}
export interface SemanticRelationsDocument {
    schema: string;
    corpus_snapshot_id: string;
    analysis_profile: SemanticAnalysisProfile;
    generation: {
        artifact_count: number;
        generated_pair_count: number;
        scored_pair_count: number;
        exhaustive_pair_count: number;
        skipped_high_frequency_terms: number;
        posting_ceiling: number;
    };
    pairs: SemanticPair[];
    classifications: PairClassification[];
    diagnostics: PairGenerationDiagnostic[];
    /** Restated so a consumer reading only this file sees the epistemic classes. */
    relation_statement: string;
}
export declare const RELATION_STATEMENT: string;
export interface TopicCandidatesDocument {
    schema: string;
    corpus_snapshot_id: string;
    analysis_profile: SemanticAnalysisProfile;
    candidates: TopicCandidate[];
    candidate_statement: string;
}
export interface ProjectCandidatesDocument {
    schema: string;
    corpus_snapshot_id: string;
    analysis_profile: SemanticAnalysisProfile;
    candidates: ProjectCandidate[];
    candidate_statement: string;
}
export interface ConsolidationCandidatesDocument {
    schema: string;
    corpus_snapshot_id: string;
    analysis_profile: SemanticAnalysisProfile;
    candidates: ConsolidationCandidate[];
    candidate_statement: string;
}
export declare const TOPIC_STATEMENT: string;
export declare const PROJECT_STATEMENT: string;
export declare const CONSOLIDATION_STATEMENT: string;
export interface SemanticAnalysisSummary {
    semantic_pair_count: number;
    topic_candidate_count: number;
    project_candidate_count: number;
    consolidation_candidate_count: number;
    reasoning_eligible_count: number;
    embedding_eligible_artifact_count: number;
    embedded_artifact_count: number;
}
export interface SemanticAnalysisResult {
    profile: SemanticAnalysisProfile;
    views: ArtifactFeatureView[];
    relations: SemanticRelationsDocument;
    topics: TopicCandidatesDocument;
    projects: ProjectCandidatesDocument;
    consolidations: ConsolidationCandidatesDocument;
    reasoningCandidates: ReasoningCandidate[];
    evidencePacks: ReasoningEvidencePack[];
    summary: SemanticAnalysisSummary;
    embeddingReport: EmbeddingRunReport;
    /** Per-artifact candidate ids, for the corpus index. */
    candidateIdsByArtifact: Map<string, {
        topic_candidate_ids: string[];
        project_candidate_ids: string[];
        consolidation_candidate_ids: string[];
        reasoning_candidate_ids: string[];
    }>;
}
export interface SemanticAnalysisInput {
    corpusSnapshotId: string;
    artifacts: readonly SemanticArtifactInput[];
    nearDuplicatePairs?: readonly {
        artifact_a_id: string;
        artifact_b_id: string;
        score: number;
    }[];
    embeddingPairs?: readonly EmbeddingPairScore[];
    embeddingReport?: EmbeddingRunReport;
    assertionsByArtifact?: ReadonlyMap<string, readonly PackAssertion[]>;
    packBudget?: Partial<ReasoningPackBudget>;
    fusion?: FusionOptions;
}
/**
 * Run the whole semantic pass.
 *
 * Order is fixed and each stage reads only what the one before it produced, so a
 * reader can follow one artifact from bytes to reasoning queue without leaving
 * this call.
 */
export declare function runSemanticAnalysis(input: SemanticAnalysisInput): SemanticAnalysisResult;
/** Canonical bytes of each emitted document. */
export declare function renderSemanticRelations(document: SemanticRelationsDocument): string;
export declare function renderTopicCandidates(document: TopicCandidatesDocument): string;
export declare function renderProjectCandidates(document: ProjectCandidatesDocument): string;
export declare function renderConsolidationCandidates(document: ConsolidationCandidatesDocument): string;
export declare function renderReasoningCandidates(rows: readonly ReasoningCandidate[]): string;
export declare function renderReasoningEvidencePacks(packs: readonly ReasoningEvidencePack[]): string;
