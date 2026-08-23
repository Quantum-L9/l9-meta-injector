import type { ConsolidationCandidate, ProjectCandidate, TopicCandidate } from "./corpus_fusion";
import type { ArtifactFeatureView } from "./corpus_semantics";
import type { SemanticPair } from "./corpus_pairs";
export declare const REASONING_ROUTING_PROFILE_ID = "reasoning-routing/v1";
export declare const REASONING_ROUTING_PROFILE_VERSION = "1.0.0";
export declare const REASONING_CANDIDATE_SCHEMA = "l9.reasoning-candidate/v1";
export declare const REASONING_EVIDENCE_PACK_SCHEMA = "l9.reasoning-evidence-pack/v1";
export declare const REASONING_TYPES: readonly ["NONE", "SAME_BODY_OF_WORK_ADJUDICATION", "PROJECT_IDENTITY_ADJUDICATION", "VERSION_EVOLUTION_ANALYSIS", "CONSOLIDATION_ANALYSIS", "SUPERSESSION_ANALYSIS", "CONFLICT_RESOLUTION_ANALYSIS"];
export type ReasoningType = (typeof REASONING_TYPES)[number];
export declare function reasoningRoutingProfileHash(): string;
export interface ReasoningCandidate {
    schema: string;
    reasoning_candidate_id: string;
    candidate_id: string;
    candidate_type: string;
    reasoning_type: ReasoningType;
    /** Why this routing was chosen. Always present, including for NONE. */
    reason: string;
    member_artifact_ids: string[];
    routing_profile: {
        reasoning_routing_profile_id: string;
        reasoning_routing_profile_version: string;
        reasoning_routing_profile_hash: string;
    };
}
export interface RouteReasoningInput {
    topicCandidates: readonly TopicCandidate[];
    projectCandidates: readonly ProjectCandidate[];
    consolidationCandidates: readonly ConsolidationCandidate[];
}
/**
 * Route every candidate, including the ones that go nowhere.
 *
 * `NONE` rows are emitted rather than dropped. A queue that silently omitted them
 * could not be checked for the property that matters most — that exact duplicates
 * and embedding-only candidates never reach a reasoner.
 */
export declare function routeReasoningCandidates(input: RouteReasoningInput): ReasoningCandidate[];
/** Candidates worth a reasoner's attention: everything not routed to NONE. */
export declare function reasoningEligible(rows: readonly ReasoningCandidate[]): ReasoningCandidate[];
export interface ReasoningPackBudget {
    maxArtifactsPerPack: number;
    maxExcerptsPerArtifact: number;
    maxExcerptCharacters: number;
    maxTotalPackCharacters: number;
}
export declare const DEFAULT_REASONING_PACK_BUDGET: ReasoningPackBudget;
/** One assertion as the pack carries it: the claim, and where to check it. */
export interface PackAssertion {
    assertion_id: string;
    predicate: string;
    object: string;
    source_path: string;
    evidence_excerpt: string;
    source_content_hash: string;
}
export interface PackArtifact {
    artifact_id: string;
    source_path: string;
    content_hash: string | null;
    archive_ancestry: string[];
    normalized_document_id: string | null;
    titles: string[];
    selected_headings: string[];
    statuses: string[];
    work_kinds: string[];
    tasks_summary: {
        open_terms: string[];
    };
    milestones: string[];
    explicit_dependencies: string[];
    explicit_references: string[];
    supersession_assertions: string[];
    /** Bounded, deterministically selected assertions with their cited excerpts. */
    excerpts: PackAssertion[];
}
export interface ReasoningEvidencePack {
    schema: string;
    evidence_pack_id: string;
    reasoning_candidate_id: string;
    candidate_id: string;
    reasoning_type: ReasoningType;
    /** Every member, always complete, even when the pack's evidence is truncated. */
    member_artifact_ids: string[];
    artifacts: PackArtifact[];
    relationship_context: {
        exact_duplicate_relations: string[];
        near_duplicate_scores: {
            pair_id: string;
            score: number;
        }[];
        lexical_pair_signals: {
            pair_id: string;
            kind: string;
            score: number;
        }[];
        embedding_scores: {
            pair_id: string;
            score: number;
        }[];
        candidate_membership: string[];
    };
    ambiguity: {
        conflict_flags: string[];
        unsupported_evidence: string[];
        coverage_gaps: string[];
    };
    truncation: {
        truncated: boolean;
        artifacts_omitted: number;
        excerpts_omitted: number;
        characters_omitted: number;
        /** Stated so a reader knows the omission was rule-based, not arbitrary. */
        selection_policy: string;
    };
    pack_profile: {
        budget: ReasoningPackBudget;
        selection_priority: readonly string[];
    };
}
export declare const PACK_SELECTION_PRIORITY: readonly string[];
export interface BuildPacksInput {
    reasoningCandidates: readonly ReasoningCandidate[];
    views: readonly ArtifactFeatureView[];
    pairs: readonly SemanticPair[];
    /** Assertions by artifact id. Secret-bearing documents never reach this map. */
    assertionsByArtifact: ReadonlyMap<string, readonly PackAssertion[]>;
    budget?: Partial<ReasoningPackBudget>;
}
/**
 * Build one bounded pack per reasoning-eligible candidate.
 *
 * `NONE` rows get no pack: the queue exists to spend attention where it can help,
 * and a pack for a candidate nobody will read is the corpus dump this module is
 * written to avoid.
 */
export declare function buildReasoningEvidencePacks(input: BuildPacksInput): ReasoningEvidencePack[];
/** Canonical JSONL: one record per line, in the order given. */
export declare function renderJsonl(records: readonly unknown[]): string;
