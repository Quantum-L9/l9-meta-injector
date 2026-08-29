import { type CanonicalValue } from "./repository_model";
export declare const CORPUS_INTELLIGENCE_PACKET_TYPE = "l9.corpus-intelligence";
export declare const CORPUS_INTELLIGENCE_PACKET_VERSION = "1.0.0";
export declare const CORPUS_INTELLIGENCE_PRODUCER_NAME = "l9-meta-injector.corpus-intelligence";
export declare const CORPUS_INTELLIGENCE_MANIFEST_VERSION = "1.0.0";
/**
 * Payload domains, in the order a reader meets them.
 *
 * Every one is serialized to its own file and its own hash. An empty array
 * means the producer found nothing of that kind, which is a different statement
 * from a domain that was never run — so every domain is always written, even
 * empty.
 */
export declare const CORPUS_PAYLOAD_FIELDS: readonly ["document_work_signals", "exact_duplicate_relations", "semantic_pair_relations", "topic_candidates", "project_candidates", "consolidation_candidates", "readiness_evidence", "reasoning_candidates", "reasoning_evidence_pack_refs"];
export type CorpusPayloadField = (typeof CORPUS_PAYLOAD_FIELDS)[number];
export declare function corpusPayloadPath(field: CorpusPayloadField): string;
export type CorpusConfidenceClass = "weak" | "moderate" | "strong";
export type CorpusCandidateType = "TOPIC_CANDIDATE" | "PROJECT_CANDIDATE" | "CONSOLIDATION_CANDIDATE";
export type CorpusRootIdentityClass = "declared" | "inferred";
export type CorpusEvidenceClass = "declared" | "observed";
export type UpstreamReasoningType = "NONE" | "SAME_BODY_OF_WORK_ADJUDICATION" | "PROJECT_IDENTITY_ADJUDICATION" | "VERSION_EVOLUTION_ANALYSIS" | "CONSOLIDATION_ANALYSIS" | "SUPERSESSION_ANALYSIS" | "CONFLICT_RESOLUTION_ANALYSIS";
export declare class CorpusIntelligenceError extends Error {
}
export interface CorpusPacketRef {
    packet_id: string;
    packet_type: string;
    packet_version: string;
    uri: string;
    semantic_hash: string;
    artifact_hash?: string;
    validation_status: "passed" | "failed" | "not_run" | "blocked";
    subject_id?: string;
    source_revision?: string;
}
export interface CorpusRootRef {
    root_id: string;
    identity_class: CorpusRootIdentityClass;
    source_revision: string;
    repository_model_packet: CorpusPacketRef;
    repository_id?: string;
}
export interface CorpusCoverage {
    root_count_requested: number;
    root_count_observed: number;
    root_count_failed: number;
    artifact_count: number;
    archive_count: number;
    archive_member_count: number;
    decoder_eligible_count: number;
    normalized_document_count: number;
    interpreted_artifact_count: number;
    unsupported_format_count: number;
    coverage_gap_count: number;
}
export interface CorpusDescriptor {
    corpus_id: string;
    corpus_source_snapshot_id: string;
    corpus_analysis_id: string;
    root_refs: CorpusRootRef[];
    coverage: CorpusCoverage;
}
export interface CorpusAnalysisProfileRef {
    profile_id: string;
    profile_version: string;
    profile_hash: string;
}
export interface DocumentWorkSignal {
    signal_id: string;
    artifact_id: string;
    subject_id: string;
    predicate: string;
    object: string;
    source_path: string;
    locator: Record<string, CanonicalValue>;
    source_content_hash: string;
    document_format: string;
    evidence_excerpt: string;
    extractor_id: string;
    decoder_id: string;
    decoder_version: string;
    evidence_class: CorpusEvidenceClass;
    authority: string;
    confidence: string;
    corpus_artifact_id: string;
    normalized_document_id: string | null;
    block_id: string;
    block_kind: string;
    extractor_profile_version: string;
}
export interface ExactDuplicateRelation {
    relation_id: string;
    duplicate_cluster_id: string;
    artifact_a_id: string;
    artifact_b_id: string;
    content_hash: string;
}
export interface PairMethodScore {
    method: string;
    score: number;
}
export interface SemanticPairRelation {
    relation_id: string;
    source_artifact_id: string;
    target_artifact_id: string;
    methods: string[];
    method_scores: PairMethodScore[];
    evidence_refs: string[];
    confidence_class: CorpusConfidenceClass;
    analysis_profile: CorpusAnalysisProfileRef;
    upstream_candidate_id: string | null;
}
export interface CandidateCluster {
    candidate_id: string;
    candidate_type: CorpusCandidateType;
    member_artifact_ids: string[];
    supporting_relation_ids: string[];
    evidence_refs: string[];
    confidence_class: CorpusConfidenceClass;
    ambiguity_flags: string[];
    cross_root: boolean;
    cross_archive: boolean;
    analysis_profile: CorpusAnalysisProfileRef;
    upstream_candidate_id: string | null;
}
export interface ReadinessEvidence {
    readiness_id: string;
    subject_id: string;
    profile_id: string;
    profile_version: string;
    source_artifact_count: number;
    test_artifact_count: number;
    build_manifest_count: number;
    ci_definition_count: number;
    deployment_definition_count: number;
    specification_count: number;
    documentation_count: number;
    plan_count: number;
    roadmap_count: number;
    wip_count: number;
    draft_count: number;
    blocked_count: number;
    open_task_count: number;
    completed_task_count: number;
    milestone_count: number;
    exact_duplicate_count: number;
    near_duplicate_count: number;
    consolidation_candidate_count: number;
    coverage_gap_count: number;
    evidence_refs: string[];
}
export interface ReasoningCandidateRequest {
    reasoning_candidate_id: string;
    candidate_id: string;
    recommended_reasoning_type: UpstreamReasoningType;
    reason: string;
    member_artifact_ids: string[];
    evidence_pack_ref: string | null;
}
export interface CorpusIntelligencePayload {
    document_work_signals: DocumentWorkSignal[];
    exact_duplicate_relations: ExactDuplicateRelation[];
    semantic_pair_relations: SemanticPairRelation[];
    topic_candidates: CandidateCluster[];
    project_candidates: CandidateCluster[];
    consolidation_candidates: CandidateCluster[];
    readiness_evidence: ReadinessEvidence[];
    reasoning_candidates: ReasoningCandidateRequest[];
    reasoning_evidence_pack_refs: string[];
}
export interface CorpusIntelligenceInputs {
    repository_model_packets: CorpusPacketRef[];
}
export interface CorpusIntelligencePacket {
    packet_type: string;
    packet_version: string;
    packet_id: string;
    producer: {
        name: string;
        version: string;
    };
    profile: {
        id: string;
        version: string;
        hash: string;
    };
    inputs: CorpusIntelligenceInputs;
    corpus: CorpusDescriptor;
    validation: {
        status: "passed" | "failed" | "not_run" | "blocked";
        receipt_ref?: string;
    };
    schema_hash: string;
    semantic_hash: string;
    artifact_hash?: string;
    payload_refs: Record<string, string>;
    payload_hashes: Record<string, string>;
    lineage: {
        parent_packet_ids: string[];
        root_packet_id: string | null;
        generation: number;
    };
    created_at: string;
}
/** One observed root, with the Repository Model Packet it produced. */
export interface CorpusIntelligenceRootInput {
    rootId: string;
    identityClass: CorpusRootIdentityClass;
    sourceRevision: string;
    repositoryId?: string;
    /** The exact packet this root produced, as emitted. */
    packet: {
        packet_id: string;
        packet_type: string;
        packet_version: string;
        semantic_hash: string;
        artifact_hash?: string;
        validation: {
            status: "passed" | "failed" | "not_run" | "blocked";
        };
        subject: {
            repository_id: string;
        };
        source_snapshot: {
            revision: string;
        };
        payload: {
            artifacts: {
                artifact_id: string;
                source_path: string;
                content_hash: string;
            }[];
        };
    };
}
export interface BuildCorpusIntelligenceInput {
    corpusId: string;
    /** Identity of what the disks held. Excludes every analysis profile. */
    corpusSourceSnapshotId: string;
    /** Identity of what was concluded, and under which rules. */
    corpusAnalysisId: string;
    roots: readonly CorpusIntelligenceRootInput[];
    coverage: CorpusCoverage;
    payload: CorpusIntelligencePayload;
    producerVersion: string;
    profile: {
        id: string;
        version: string;
        hash: string;
    };
    createdAt: string;
}
/**
 * Refuse a packet that is not referentially sound.
 *
 * The consumer runs the same checks and refuses the whole packet rather than
 * compiling the resolvable part, so failing here is not redundant: it turns a
 * producer defect into a producer error, at the point where the run that caused
 * it is still in hand.
 */
export declare function validateCorpusIntelligencePacket(packet: CorpusIntelligencePacket, payload: CorpusIntelligencePayload, roots: readonly CorpusIntelligenceRootInput[]): string[];
/** Build the canonical packet from one corpus run's own analysis output. */
export declare function buildCorpusIntelligencePacket(input: BuildCorpusIntelligenceInput): {
    packet: CorpusIntelligencePacket;
    payload: CorpusIntelligencePayload;
};
export interface CorpusBundleFile {
    path: string;
    media_type: string;
    content_hash: string;
    size_bytes: number;
}
export interface CorpusIntelligenceBundle {
    /** Files relative to the bundle root, in code-point order. */
    files: {
        path: string;
        contents: string;
    }[];
    manifest: {
        manifest_version: string;
        packet_id: string;
        packet_type: string;
        packet_version: string;
        semantic_hash: string;
        artifact_hash: string;
        files: CorpusBundleFile[];
        created_at: string;
    };
}
/**
 * Render the packet and its payload as an integrity-bound bundle.
 *
 * Returned rather than written, so a caller can publish it atomically with the
 * generation it describes instead of leaving a window where one exists without
 * the other.
 */
export declare function buildCorpusIntelligenceBundle(packet: CorpusIntelligencePacket, payload: CorpusIntelligencePayload, options: {
    createdAt: string;
}): CorpusIntelligenceBundle;
/** Write a bundle to disk. Refuses to write into a non-empty directory. */
export declare function writeCorpusIntelligenceBundle(bundle: CorpusIntelligenceBundle, outDir: string): string;
