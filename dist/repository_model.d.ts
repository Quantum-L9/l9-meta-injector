import { InventoryResult } from "./inventory";
import { type InterpretationResult } from "./repository_interpretation";
export declare const REPOSITORY_MODEL_PACKET_TYPE = "l9.repository-model";
export declare const REPOSITORY_MODEL_PACKET_VERSION = "1.0.0";
export declare const REPOSITORY_MODEL_PRODUCER_NAME = "l9-meta-injector.repository-model";
export type CanonicalValue = string | number | boolean | null | CanonicalValue[] | {
    [key: string]: CanonicalValue;
};
export type RepositoryModelConfidenceLevel = "low" | "medium" | "high";
export type RepositoryModelEvidenceStrength = "none" | "weak" | "corroborated" | "direct";
export type RepositoryModelDerivationMethod = "declared" | "deterministic" | "cross-record" | "heuristic" | "model-assisted" | "unknown";
export type RepositoryModelAuthority = "source" | "validated-machine" | "derived" | "candidate" | "unknown";
export type RepositoryModelCompleteness = "partial" | "sufficient" | "complete";
export type RepositoryModelConflictStatus = "none" | "possible" | "confirmed";
export interface RepositoryModelConfidence {
    level: RepositoryModelConfidenceLevel;
    evidence_strength: RepositoryModelEvidenceStrength;
    derivation_method: RepositoryModelDerivationMethod;
    authority: RepositoryModelAuthority;
    completeness: RepositoryModelCompleteness;
    conflict_status: RepositoryModelConflictStatus;
}
export interface RepositoryModelSourceRef {
    source_path?: string;
    line_number?: number;
    content_hash?: string;
    source_revision?: string;
}
export type RepositoryModelEvidenceClass = "observed" | "declared" | "derived" | "assisted" | "projected" | "validated" | "committed";
export type RepositoryModelEvidenceSourceType = "file" | "packet" | "inference" | "validation" | "unknown";
export interface RepositoryModelEvidenceRecord {
    evidence_id: string;
    subject_id: string;
    field?: string;
    stage: string;
    evidence_class: RepositoryModelEvidenceClass;
    source_type: RepositoryModelEvidenceSourceType;
    source_ref: RepositoryModelSourceRef;
    value: CanonicalValue;
    confidence: RepositoryModelConfidence;
    producer: string;
    producer_version: string;
    created_at: string;
}
export interface RepositoryModelArtifactRecord {
    artifact_id: string;
    repository_id: string;
    source_path: string;
    artifact_type: string;
    family?: string;
    content_hash: string;
    body_hash?: string;
    capabilities: string[];
    dependencies: string[];
    evidence_refs: string[];
    packet_ref: string;
    confidence: RepositoryModelConfidence;
}
export interface RepositoryModelRepositoryRecord {
    repository_id: string;
    name: string;
    source_revision: string;
    packet_ref: string;
    primary_role: string;
    secondary_roles: string[];
    languages: string[];
    package_managers: string[];
    entrypoints: string[];
    workflows: string[];
    adr_refs: string[];
    governance_refs: string[];
    capability_ids: string[];
    artifact_ids: string[];
    upstream_repository_ids: string[];
    downstream_repository_ids: string[];
    unresolved_dependencies: string[];
    owner_ids: string[];
    evidence_refs: string[];
    confidence: RepositoryModelConfidence;
}
export interface RepositoryModelCapabilityRecord {
    capability_id: string;
    name: string;
    description: string;
    implemented_by: string[];
    exposed_by: string[];
    validated_by: string[];
    governed_by: string[];
    evidence_refs: string[];
    confidence: RepositoryModelConfidence;
}
export type RepositoryModelEdgeType = "CONTAINS" | "DEPENDS_ON" | "IMPLEMENTS" | "EXPOSES" | "VALIDATED_BY" | "GOVERNED_BY" | "OWNED_BY" | "DOCUMENTED_BY" | "PRODUCES" | "CONSUMES" | "DERIVED_FROM" | "SUPERSEDES" | "ROUTES_TO" | "PUBLISHES_TO" | "MEMBER_OF";
export interface RepositoryModelEdgeRecord {
    edge_id: string;
    source_id: string;
    target_id: string;
    edge_type: RepositoryModelEdgeType;
    direction: "outbound" | "inbound" | "bidirectional";
    properties: Record<string, CanonicalValue>;
    evidence_refs: string[];
    confidence: RepositoryModelConfidence;
}
export interface RepositoryModelDiagnostic {
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
    stage: string;
    category: string;
    subject_id?: string;
    evidence_refs?: string[];
    details?: Record<string, CanonicalValue>;
}
export interface RepositoryModelPayload {
    repositories: RepositoryModelRepositoryRecord[];
    artifacts: RepositoryModelArtifactRecord[];
    capabilities: RepositoryModelCapabilityRecord[];
    relationships: RepositoryModelEdgeRecord[];
    evidence: RepositoryModelEvidenceRecord[];
    diagnostics: RepositoryModelDiagnostic[];
}
export interface RepositoryModelPacket {
    packet_type: string;
    packet_version: string;
    packet_id: string;
    subject: {
        repository_id: string;
    };
    source_snapshot: {
        revision: string;
        semantic_hash: string;
    };
    validation: {
        status: "passed" | "failed" | "not_run" | "blocked";
        receipt_ref?: string;
    };
    producer: {
        name: string;
        version: string;
    };
    profile: {
        id: string;
        version: string;
        hash: string;
    };
    schema_hash: string;
    semantic_hash: string;
    artifact_hash?: string;
    payload_refs: Record<string, string>;
    payload: RepositoryModelPayload;
}
export interface RepositoryModelValidationCheck {
    check_id: string;
    check_class: "schema" | "invariant" | "evidence" | "cross-reference";
    rule: string;
    status: "passed" | "failed" | "blocked" | "not_run";
    message: string;
    path?: string;
    evidence_refs: string[];
    details: Record<string, CanonicalValue>;
}
export interface RepositoryModelValidationReceipt {
    packet_type: string;
    packet_version: string;
    receipt_id: string;
    subject_packet_id: string;
    subject_semantic_hash: string;
    validator: {
        name: string;
        version: string;
    };
    status: "passed" | "failed" | "not_run" | "blocked";
    schema_results: RepositoryModelValidationCheck[];
    invariant_results: RepositoryModelValidationCheck[];
    evidence_results: RepositoryModelValidationCheck[];
    cross_reference_results: RepositoryModelValidationCheck[];
    created_at: string;
    semantic_hash: string;
}
export interface RepositoryModelValidationResult {
    status: "passed" | "failed";
    checks: RepositoryModelValidationCheck[];
}
export interface RepositoryModelBuildInput {
    /** Inventory observation of the repository. Produced by `inventoryTree`. */
    inventory: InventoryResult;
    /**
     * Deterministic structured interpretation of the same observation. Optional: without it
     * the packet carries inventory evidence only, exactly as before. Its profile identity
     * participates in the packet's profile identity, so changing extraction policy changes
     * the packet's semantic hash even when the repository bytes are unchanged.
     */
    interpretations?: InterpretationResult;
    /** Canonical repository name, e.g. `l9-meta-injector`. */
    repositoryName: string;
    /** Explicit source revision, e.g. `git:<40-hex>`. Never inferred. */
    sourceRevision: string;
    /** Producer version recorded in the packet and in every evidence record. */
    producerVersion: string;
    /** Emission timestamp; excluded from semantic identity. */
    generatedAt?: string;
}
export interface RepositoryModelObservationInput {
    /** Repository root to observe. */
    root: string;
    repositoryName: string;
    sourceRevision: string;
    producerVersion: string;
    generatedAt?: string;
    ignore?: string[];
    omitPatterns?: string[];
    omitFile?: string;
    hashMaxBytes?: number;
    /** Set false to emit an inventory-only packet with no structured interpretation. */
    interpret?: boolean;
}
export interface RepositoryModelEmitResult {
    bundleRoot: string;
    packetPath: string;
    receiptPath: string;
    manifestPath: string;
    packetId: string;
    semanticHash: string;
    files: {
        path: string;
        media_type: string;
        content_hash: string;
        size_bytes: number;
    }[];
}
/**
 * Build a Repository Model Packet from an inventory observation.
 *
 * Every emitted assertion traces back to a real repository observation. Domains with
 * no supporting evidence stay empty and are reported as diagnostics rather than filled
 * with plausible-looking inference.
 */
export declare function buildRepositoryModelPacket(input: RepositoryModelBuildInput): RepositoryModelPacket;
/**
 * Validate a packet against the contract this producer is responsible for, before it
 * ever reaches a consumer. Failures are reported, never repaired silently.
 */
export declare function validateRepositoryModelPacket(packet: RepositoryModelPacket): RepositoryModelValidationResult;
/**
 * Write a validated packet as a canonical packet-bundle directory:
 * `packet.json`, `receipts/validation-receipt.json`, and a hash-bound `manifest.json`.
 * Refuses to emit a packet that fails producer-side validation.
 */
export declare function emitRepositoryModelBundle(packet: RepositoryModelPacket, options: {
    outDir: string;
    producerVersion?: string;
    generatedAt?: string;
}): RepositoryModelEmitResult;
/**
 * Observe a repository with the existing inventory engine and build its Repository
 * Model Packet. The observation is read-only: inventory runs in dry-run mode and its
 * own manifests are written to a temporary directory that is removed afterwards, so
 * the observed repository is never mutated.
 */
export declare function observeRepositoryModel(input: RepositoryModelObservationInput): RepositoryModelPacket;
