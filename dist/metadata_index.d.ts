/**
 * Deterministic central metadata index.
 *
 * The index is newline-delimited canonical JSON at `.l9/metadata-index.jsonl`.
 * It is the sole default metadata carrier for source, configuration, test,
 * automation, infrastructure, structured data, and inventory-only artifacts.
 * This module never creates adjacent sidecars or inject logs.
 */
import type { ArtifactType } from "./schema";
import type { AuthorityConfig, CarrierDecision, MetadataCarrier, OperationMode } from "./operation_contracts";
import { type CarrierSubject } from "./mutation_policy";
import { TRACKED_COVERAGE_SCHEMA, TRACKED_POLICY_SCHEMA, type TrackedGitEntry, type TrackedGitSnapshot, type TrackedCarrierDecision, type LegacyTrackedAliasGroup } from "./discovery_contracts";
export declare const METADATA_INDEX_SCHEMA: "l9.metadata-index/v1";
export declare const METADATA_INDEX_RELATIVE_PATH: ".l9/metadata-index.jsonl";
export type MaterializedMetadataCarrier = Exclude<MetadataCarrier, "hard_skip">;
export interface ManagedMetadataSubject extends CarrierSubject {
    contentHash: string;
    metadata: Readonly<Record<string, unknown>>;
}
export interface MetadataIndexRecord {
    schema: typeof METADATA_INDEX_SCHEMA;
    path: string;
    carrier: MaterializedMetadataCarrier;
    artifact_type: ArtifactType;
    content_hash: string;
    metadata: Record<string, unknown>;
}
export interface MetadataIndexCompilation {
    records: MetadataIndexRecord[];
    bytes: string;
    sha256: string;
    carrierDecisions: CarrierDecision[];
}
export interface CompileMetadataIndexInput {
    authority: AuthorityConfig;
    mode: OperationMode;
    subjects: readonly ManagedMetadataSubject[];
    /**
     * Existing index records carried forward verbatim (ADR-058). A scoped governed run
     * passes the records of paths its discovery ledger marked scope-filtered; they are
     * merged with the records compiled from `subjects` and validated as one index.
     * Carrier decisions still cover `subjects` only.
     */
    preservedRecords?: readonly MetadataIndexRecord[];
}
export interface WriteMetadataIndexOptions {
    dryRun?: boolean;
}
export interface WriteMetadataIndexResult extends MetadataIndexCompilation {
    absolutePath: string;
    relativePath: typeof METADATA_INDEX_RELATIVE_PATH;
    changed: boolean;
    written: boolean;
}
/**
 * Why the index schema cannot represent `pathName`, or null when it can.
 *
 * Shared with discovery (DEC-RC-013 option B), which holds such a file with a
 * blocking disposition so `check` reports it instead of the producer throwing.
 */
export declare function metadataIndexPathProblem(pathName: string): string | null;
export declare function serializeMetadataIndex(records: readonly MetadataIndexRecord[]): string;
export declare function compileMetadataIndex(input: CompileMetadataIndexInput): MetadataIndexCompilation;
export declare function writeMetadataIndex(root: string, input: CompileMetadataIndexInput, options?: WriteMetadataIndexOptions): WriteMetadataIndexResult;
export declare function parseMetadataIndex(bytes: string): MetadataIndexRecord[];
/** Separate opt-in wire contract. The v1 constant, parser and bytes remain unchanged. */
export declare const METADATA_INDEX_SCHEMA_V2: "l9.metadata-index/v2";
export declare const LEGACY_ALIAS_SCHEMA: "l9.namespace-alias/v1";
export interface MetadataIndexHeaderV2 {
    schema: typeof METADATA_INDEX_SCHEMA_V2;
    kind: "header";
    repository_id: string;
    producer_version: string;
    policy_contract: typeof TRACKED_POLICY_SCHEMA;
    /** Frozen v1 claims only; never current records, aliases, or current-content proof. */
    legacy_identity_claims?: MetadataIndexLegacyIdentityClaimsV2;
}
export interface MetadataIndexRecordV2 {
    schema: typeof METADATA_INDEX_SCHEMA_V2;
    path: string;
    path_bytes_base64: string;
    carrier: "central_manifest" | "inventory_only";
    artifact_type: "unknown";
    content_kind: "Unknown";
    content_hash: null;
    content_hash_scope: "not_inspected";
    git: {
        mode: TrackedGitEntry["mode"];
        object_type: TrackedGitEntry["object_type"];
        object_oid: string;
        object_format: TrackedGitSnapshot["object_format"];
    };
    metadata: {
        id: string;
        repository_id: string;
        legacy_alias: {
            schema: typeof LEGACY_ALIAS_SCHEMA;
            id: string;
        };
    };
}
export interface TrackedCoverageReceipt {
    schema: typeof TRACKED_COVERAGE_SCHEMA;
    policy_contract: typeof TRACKED_POLICY_SCHEMA;
    producer_version: string;
    repository_id: string;
    snapshot: {
        revision: string;
        tree_oid: string;
        object_format: TrackedGitSnapshot["object_format"];
    };
    population: "tracked_tree_leaves";
    subject_content_reads: false;
    source_mutation: "never";
    host_materializability: "not_assessed";
    authority_inspection: "not_performed";
    index: {
        schema: typeof METADATA_INDEX_SCHEMA_V2;
        sha256: string;
    };
    entries: Array<TrackedCarrierDecision & {
        id: string;
        content_hash: null;
        content_hash_scope: "not_inspected";
    }>;
    alias_ambiguities: LegacyTrackedAliasGroup[];
    totals: {
        tree_leaves: number;
        indexed: number;
        protected: number;
        unsupported: number;
    };
    closure: "exact_set_verified";
}
export interface TrackedMetadataCompilation {
    header: MetadataIndexHeaderV2;
    records: MetadataIndexRecordV2[];
    bytes: string;
    sha256: string;
    carrierDecisions: TrackedCarrierDecision[];
    coverage: TrackedCoverageReceipt;
    coverageBytes: string;
}
export interface CompileTrackedMetadataInput {
    snapshot: TrackedGitSnapshot;
    producerVersion: string;
    /** Optional pre-resolved decisions must prove exact evidence and policy equality. */
    decisions?: readonly TrackedCarrierDecision[];
    /** Supplied only by the shared migration/replay plan, not a workflow override. */
    legacyIdentityClaims?: MetadataIndexLegacyIdentityClaimsV2;
}
/** Counts are informational. Equality is established on raw paths and all Git evidence. */
export declare function assertTrackedDecisionCoverage(snapshot: TrackedGitSnapshot, decisions: readonly TrackedCarrierDecision[]): void;
export declare function serializeMetadataIndexV2(records: readonly MetadataIndexRecordV2[], header: MetadataIndexHeaderV2): string;
export declare function parseMetadataIndexV2(bytes: string): MetadataIndexRecordV2[];
export type VersionedMetadataIndex = {
    schema: typeof METADATA_INDEX_SCHEMA;
    records: MetadataIndexRecord[];
} | {
    schema: typeof METADATA_INDEX_SCHEMA_V2;
    header: MetadataIndexHeaderV2;
    records: MetadataIndexRecordV2[];
};
/** v1 admits empty JSONL; v2 always requires its explicit header. */
export declare function readVersionedMetadataIndex(bytes: string): VersionedMetadataIndex;
export declare function compileTrackedMetadataIndex(input: CompileTrackedMetadataInput): TrackedMetadataCompilation;
/** Bind materialization to the census and reject missing/extra/evidence-swapped records. */
export declare function assertTrackedIndexCoverage(snapshot: TrackedGitSnapshot, decisions: readonly TrackedCarrierDecision[], records: readonly MetadataIndexRecordV2[]): void;
/** Receipt-only verification reconstructs the declared population; an external census binds its truth. */
export declare function parseTrackedCoverage(bytes: string, snapshot: TrackedGitSnapshot, records: readonly MetadataIndexRecordV2[], header?: MetadataIndexHeaderV2): TrackedCoverageReceipt;
/** Legacy unscoped rebuilds may repair corrupt v1, never implicitly replace versioned stores. */
export declare function assertLegacyMetadataIndexWrite(bytes: string): void;
export interface TrackedMetadataIndexBase {
    exists: boolean;
    unmergeableReason?: string;
    sha256?: string;
    bytes?: string;
    index?: VersionedMetadataIndex;
}
/**
 * Single producer-owned byte observation for tracked bases and legacy admission.
 * Only open's ENOENT admits absence; links (including dangling links) and special
 * entries are refused. Hash the same FD bytes that the caller classifies. Parsing
 * stays with the version owner so legacy corrupt-v1 repair remains compatible.
 */
export declare function readMetadataIndexBaseBytes(rootInput: string): {
    exists: false;
} | {
    exists: true;
    raw: Buffer;
    sha256: string;
};
/** Read only the active managed index, never a subject. Dangling symlinks count as unsafe. */
export declare function readTrackedMetadataIndexBase(rootInput: string): TrackedMetadataIndexBase;
export declare const METADATA_INDEX_MIGRATION_SCHEMA_V2: "l9.metadata-index-migration/v2";
export interface MetadataIndexLegacyRecordV2 {
    path: string;
    path_bytes_base64: string;
    canonical_id: string;
    legacy_metadata_id: unknown;
    legacy_id_state: "present" | "absent";
    legacy_content_hash_claim: string;
    legacy_content_hash_scope: "legacy_v1_claim_not_revalidated";
    snapshot_presence: "tracked" | "absent_from_snapshot";
}
/** Historical/unverified claims in the one active header; deliberately no target hash. */
export interface MetadataIndexLegacyIdentityClaimsV2 {
    source_index: {
        schema: typeof METADATA_INDEX_SCHEMA;
        sha256: string;
    };
    snapshot_at_migration: {
        revision: string;
        tree_oid: string;
        object_format: TrackedGitSnapshot["object_format"];
    };
    legacy_records: MetadataIndexLegacyRecordV2[];
}
/** External evidence binds the final index bytes without introducing a self-reference. */
export interface MetadataIndexMigrationEvidenceV2 {
    schema: typeof METADATA_INDEX_MIGRATION_SCHEMA_V2;
    repository_id: string;
    snapshot: {
        revision: string;
        tree_oid: string;
        object_format: TrackedGitSnapshot["object_format"];
    };
    source_index: {
        schema: typeof METADATA_INDEX_SCHEMA;
        sha256: string;
    };
    target_index: {
        schema: typeof METADATA_INDEX_SCHEMA_V2;
        sha256: string;
    };
    legacy_records: MetadataIndexLegacyRecordV2[];
}
/** Compile before the target: preserve all prior claims, even absent/protected paths. */
export declare function compileMetadataIndexLegacyIdentityClaims(base: VersionedMetadataIndex, sourceSha256: string, snapshot: TrackedGitSnapshot): MetadataIndexLegacyIdentityClaimsV2;
/** Complete external evidence is emitted only after final target serialization. */
export declare function compileMetadataIndexMigrationEvidence(base: VersionedMetadataIndex, sourceSha256: string, target: TrackedMetadataCompilation, snapshot: TrackedGitSnapshot): MetadataIndexMigrationEvidenceV2;
/** Retention is historical, never an override of the deterministic active alias projection. */
export declare function metadataIndexMigrationAliasProblem(base: VersionedMetadataIndex, target: TrackedMetadataCompilation): string | null;
