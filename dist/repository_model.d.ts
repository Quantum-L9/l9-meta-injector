import { InventoryResult } from "./inventory";
import { InterpretationResult } from "./interpretation";
/** Re-exported so packet consumers keep one ordering import site. */
export { compareCodePoints } from "./ordering";
export declare const REPOSITORY_MODEL_PACKET_TYPE = "l9.repository-model";
export declare const REPOSITORY_MODEL_PACKET_VERSION = "1.1.0";
export declare const REPOSITORY_MODEL_PRODUCER_NAME = "l9-meta-injector.repository-model";
/**
 * A number the contract calls a measurement rather than a count.
 *
 * This runtime has one numeric type; CPython has two, and renders them
 * differently — a score of exactly `1` is `1` here and `1.0` there. Nothing
 * about the value says which it is, so the distinction is carried explicitly
 * rather than guessed from whether the value happens to be integral. Guessing
 * would be right for `0.85` and wrong for `1`, and `1` is the value a
 * categorical signal carries when it fires.
 */
export declare class CanonicalFloat {
    readonly value: number;
    constructor(value: number);
}
/** Mark a number as a float measurement. */
export declare function canonicalFloat(value: number): CanonicalFloat;
export type CanonicalValue = string | number | boolean | null | CanonicalFloat | CanonicalValue[] | {
    [key: string]: CanonicalValue;
};
/** Canonical JSON text for any packet-shaped value. */
export declare function canonicalJson(value: unknown): string;
/** Content identity of exact text, used by interpretation evidence. */
export declare function sha256TextPrefixed(value: string): string;
/** Semantic identity: volatile fields removed, then canonical bytes hashed. */
export declare function semanticHash(value: unknown): string;
export declare function stableId(prefix: string, value: unknown): string;
/**
 * Stable identity of one artifact inside a repository.
 *
 * Interpretation needs this to point an assertion at the exact file that made a
 * declaration, and the packet builder needs it to emit that file's artifact
 * record. Two implementations of the same formula would eventually disagree and
 * strand every artifact-scoped assertion, so both call this one.
 *
 * `sourcePath` is the repository-relative POSIX path, or a virtual archive
 * member locator such as `Bundle.zip!/docs/a.md`. Absolute paths never
 * participate.
 */
export declare function repositoryModelArtifactId(repositoryId: string, sourcePath: string): string;
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
/**
 * A semantic claim the repository makes about itself, carried across the packet
 * boundary as first-class typed data.
 *
 * Assertions are deliberately not folded into `diagnostics`: a diagnostic
 * reports something about the observation run, while an assertion is repository
 * truth a consumer reconciles. Encoding one as the other to avoid extending the
 * contract would make semantic content unreadable without string parsing.
 *
 * Every field is required. An assertion that cannot cite an exact span in a
 * hashed source file is not emitted at all.
 */
export interface RepositoryModelAssertionRecord {
    assertion_id: string;
    subject_id: string;
    predicate: string;
    object: string;
    source_path: string;
    source_range: {
        start_line: number;
        end_line: number;
    };
    evidence_excerpt: string;
    source_content_hash: string;
    extractor_id: string;
    evidence_class: "declared" | "observed";
    authority: RepositoryModelAuthority;
    confidence: RepositoryModelConfidenceLevel;
}
export interface RepositoryModelPayload {
    repositories: RepositoryModelRepositoryRecord[];
    artifacts: RepositoryModelArtifactRecord[];
    capabilities: RepositoryModelCapabilityRecord[];
    relationships: RepositoryModelEdgeRecord[];
    evidence: RepositoryModelEvidenceRecord[];
    diagnostics: RepositoryModelDiagnostic[];
    /** Semantic claims from the interpretation pass; empty when it did not run. */
    assertions: RepositoryModelAssertionRecord[];
}
/** Identity of the interpretation profile, present only when it ran. */
export interface RepositoryModelInterpretationProfile {
    profile_id: string;
    profile_version: string;
    profile_hash: string;
    extractor_versions: Record<string, string>;
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
    /** Present only when the interpretation pass ran, so it binds identity only then. */
    interpretation_profile?: RepositoryModelInterpretationProfile;
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
/** One archive observed inside a local source, expanded or held. */
export interface RepositoryModelArchiveInput {
    /** Source-relative POSIX path, or a virtual locator when the archive is nested. */
    sourcePath: string;
    /** `sha256:`-prefixed digest of the exact archive bytes, or the Unknown value. */
    contentHash: string;
    sizeBytes: number;
    nestedDepth: number;
    parentArchivePath: string | null;
    parentArchiveHash: string | null;
    expanded: boolean;
    memberCount: number;
    omittedMemberCount: number;
    /** Stable codes for the preflight or budget violations that held this archive. */
    holdCodes: string[];
}
/** One archive member, carried as a virtual artifact with exact provenance. */
export interface RepositoryModelArchiveMemberInput {
    /** Machine-independent locator, e.g. `Bundle.zip!/docs/a.md`. */
    virtualSourcePath: string;
    memberPath: string;
    contentHash: string;
    sizeBytes: number;
    parentArchivePath: string;
    parentArchiveHash: string;
    nestedDepth: number;
}
export interface RepositoryModelLocalSourceDiagnostic {
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
    sourcePath?: string;
}
/**
 * Provenance overlay for a packet built from a local filesystem source.
 *
 * The artifacts themselves arrive through the inventory records, exactly as
 * repository files do. This overlay adds what inventory cannot express: which
 * artifacts are archives, which are members of which archive, and the chain that
 * links a member of a nested archive back to the outermost source file.
 */
export interface RepositoryModelLocalSourceInput {
    sourceKind: "file" | "directory" | "archive";
    /** Version of the archive resource budget that produced this observation. */
    archivePolicyVersion: string;
    archives: RepositoryModelArchiveInput[];
    members: RepositoryModelArchiveMemberInput[];
    diagnostics: RepositoryModelLocalSourceDiagnostic[];
}
export interface RepositoryModelBuildInput {
    /** Inventory observation of the repository. Produced by `inventoryTree`. */
    inventory: InventoryResult;
    /** Canonical repository name, e.g. `l9-meta-injector`. */
    repositoryName: string;
    /** Explicit source revision, e.g. `git:<40-hex>`. Never inferred. */
    sourceRevision: string;
    /** Producer version recorded in the packet and in every evidence record. */
    producerVersion: string;
    /** Emission timestamp; excluded from semantic identity. */
    generatedAt?: string;
    /**
     * Result of the deterministic interpretation pass. Optional: a packet built
     * without it carries an empty assertion domain and no interpretation profile,
     * which is exactly how packets behaved before the domain existed.
     */
    interpretation?: InterpretationResult;
    /**
     * Archive provenance for a packet built from a local filesystem source.
     * Absent for an ordinary repository observation, which keeps its prior identity.
     */
    localSource?: RepositoryModelLocalSourceInput;
}
export interface RepositoryModelObservationInput {
    /** Repository root to observe. */
    root: string;
    repositoryName: string;
    sourceRevision: string;
    producerVersion: string;
    generatedAt?: string;
    /**
     * Run the deterministic interpretation pass and carry its assertions into the
     * packet. Defaults to true: observation that reads a repository and discards
     * what it declares is the behavior this seam exists to correct. Set false to
     * emit an inventory-only packet.
     */
    interpret?: boolean;
    ignore?: string[];
    omitPatterns?: string[];
    omitFile?: string;
    hashMaxBytes?: number;
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
