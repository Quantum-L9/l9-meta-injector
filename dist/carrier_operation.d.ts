/**
 * Shared carrier-aware planning for governed check/apply operations.
 *
 * This module is the single bridge from the canonical pipeline's metadata plan
 * to the carrier policy. It never writes source files, adjacent sidecars, logs,
 * reports, or indexes. Both check and apply consume the exact same plan.
 */
import type { AuthorityConfig, CarrierDecision, CheckDrift, TrackedCoverageInput, TrackedCheckInput, TrackedApplyInput, AuthorityConflict, AuthorityNotice } from "./operation_contracts";
import { type MetadataIndexCompilation, type TrackedMetadataCompilation, type TrackedMetadataIndexBase, type MetadataIndexMigrationEvidenceV2 } from "./metadata_index";
import { type PipelineMetadataSubject, type PipelineResult } from "./pipeline";
import type { InjectionRecord, PipelineConfig } from "./schema";
import { type TrackedGitSnapshot } from "./discovery_contracts";
import { type RepositoryAuthorityInspection } from "./authority_scan";
import { type FileTransactionResult } from "./file_transaction";
export declare const CANONICAL_METADATA_WRITER: "Quantum-L9/l9-meta-injector";
export type GovernedCarrierMode = "check" | "apply";
export interface CarrierOperationPlan {
    mode: GovernedCarrierMode;
    root: string;
    authority: AuthorityConfig;
    pipeline: PipelineResult;
    subjects: PipelineMetadataSubject[];
    carrierDecisions: CarrierDecision[];
    metadataIndex: MetadataIndexCompilation;
    /**
     * The existing index a scoped run merged with (ADR-058), or null for an unscoped run,
     * which never reads it. Apply binds the index intent's compare-and-swap to this base.
     * `unmergeableReason` is set when the base cannot be preserved: check reports it as a
     * conflict and apply refuses before any write.
     */
    metadataIndexBase: {
        exists: boolean;
        sha256?: string;
        unmergeableReason?: string;
    } | null;
    inlinePlans: InjectionRecord[];
}
export interface PlanCarrierOperationInput {
    mode: GovernedCarrierMode;
    authority: AuthorityConfig;
    config: PipelineConfig;
}
export declare function buildCarrierOperationPlan(mode: GovernedCarrierMode, rootInput: string, authority: AuthorityConfig, pipeline: PipelineResult): CarrierOperationPlan;
export declare function planCarrierOperationAsync(input: PlanCarrierOperationInput): Promise<CarrierOperationPlan>;
export declare function metadataIndexDrift(plan: CarrierOperationPlan): CheckDrift | null;
/**
 * Drift for decisions the repository's own authority asked for but cannot receive.
 *
 * A malformed header under an explicit `inline_allow` authorization is reported here, not
 * repaired: preserving the file's bytes outranks satisfying the authorization.
 */
export declare function unsatisfiedAuthorizationDrift(plan: CarrierOperationPlan): CheckDrift[];
export declare function inlinePlanDrift(plan: CarrierOperationPlan): CheckDrift[];
export interface TrackedOperationPlan {
    root: string;
    snapshot: TrackedGitSnapshot;
    metadataIndex: TrackedMetadataCompilation;
    metadataIndexBase: TrackedMetadataIndexBase;
    authorityInspection: RepositoryAuthorityInspection;
    migrationEvidence: MetadataIndexMigrationEvidenceV2 | null;
}
export interface TrackedCheckResult {
    mode: "tracked-check";
    passed: boolean;
    repositoryMutated: false;
    sourceMutated: false;
    authorityInspection: "performed";
    authorityConflicts: AuthorityConflict[];
    authorityNotices: AuthorityNotice[];
    drift: CheckDrift[];
    metadataIndex: TrackedMetadataCompilation;
    migrationEvidence: MetadataIndexMigrationEvidenceV2 | null;
}
export interface TrackedApplyResult {
    mode: "tracked-apply";
    passed: true;
    repositoryMutated: boolean;
    sourceMutated: false;
    authorityInspection: "performed";
    authorityConflicts: AuthorityConflict[];
    authorityNotices: AuthorityNotice[];
    metadataIndex: TrackedMetadataCompilation;
    transaction: FileTransactionResult;
    migrationEvidence: MetadataIndexMigrationEvidenceV2 | null;
}
/** Immutable tree metadata only. No pipeline/authority scan, subject reads, or writes. */
export declare function runTrackedCoverage(input: TrackedCoverageInput): TrackedMetadataCompilation;
/** One plan is shared by versioned check/apply; no inline or adjacent-sidecar intents exist. */
export declare function planTrackedOperation(input: TrackedCheckInput): TrackedOperationPlan;
/** Read-only/in-memory by default; authority inspection is explicit and not content-free. */
export declare function runTrackedCheckAsync(input: TrackedCheckInput): Promise<TrackedCheckResult>;
/** Only the active canonical index may be committed; all census sources remain read-only. */
export declare function runTrackedApplyAsync(input: TrackedApplyInput): Promise<TrackedApplyResult>;
