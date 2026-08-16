import { PipelineConfig, NormalizedMeta, InjectionRecord, VerifyResult } from "./schema";
import { scanFiles } from "./retrieval";
import type { CarrierInjectionStrategy } from "./mutation_policy";
import type { DiscoverySummary } from "./discovery_contracts";
import { PlacementPlan } from "./placement_policy";
import { MetaV3Record } from "./meta_v3";
import { MetricsSnapshot } from "./metrics";
import { type FrontMatterIssueCode } from "./frontmatter_patch";
import { ArchiveRecord } from "./archives";
export interface VerificationSummary {
    total: number;
    clean: number;
    withIssues: number;
    /** True iff every verified file passed with zero issues. Callers/CI should gate on this. */
    passed: boolean;
    failures: Array<{
        sourcePath: string;
        issues: string[];
    }>;
}
/**
 * Why a discovered markdown file cannot act as its own inline metadata carrier.
 *
 * Valid-but-unsupported frontmatter (`malformed: false`) is a limitation of the
 * byte-preserving patcher, not a defect in the file. Either way the source bytes are left
 * untouched and the file is carried by the central manifest instead; the run continues.
 */
export interface InlineCarrierBlock {
    code: FrontMatterIssueCode;
    message: string;
    line?: number;
    /** True when the header is structurally broken rather than merely unsupported. */
    malformed: boolean;
}
/** Per-path detail for a non-injectable skip (OBS-003 / ADR-018). */
export interface NonInjectableSkipDetail {
    path: string;
    reason: "taxonomy_non_injectable";
    artifactType: string;
    confidence: "high" | "medium" | "low";
}
export interface PipelineMetadataSubject {
    path: string;
    artifactType: NormalizedMeta["artifact_type"];
    strategy: CarrierInjectionStrategy;
    contentHash: string;
    metadata: Readonly<Record<string, unknown>>;
    /** Present when this file's existing frontmatter cannot be safely inline-patched. */
    inlineCarrierBlock?: InlineCarrierBlock;
}
export interface CoverageSummary {
    scanned: number;
    injected: number;
    skippedBinary: number;
    skippedNonInjectable: number;
    verifyFailed: number;
    /** Archives expanded when `localFiles` is on (0 otherwise). */
    archivesExpanded: number;
    /** Source paths skipped, by reason — so coverage gaps are correlatable to inputs. */
    skipped: {
        binary: string[];
        nonInjectable: string[];
        /** Classification detail for each non-injectable skip (same order as `nonInjectable`). */
        nonInjectableDetails: NonInjectableSkipDetail[];
    };
    /** Runtime path of coverage-report.json, empty when persistence is disabled. */
    reportPath: string;
    /** Complete deterministic terminal disposition ledger for encountered paths. */
    discovery: DiscoverySummary;
}
export interface PipelineResult {
    /** Runtime envelope timestamp. It is not embedded into canonical file metadata. */
    runStartedAt: string;
    scanned: ReturnType<typeof scanFiles>;
    /** Canonical metadata subjects before carrier selection. */
    metadataSubjects: PipelineMetadataSubject[];
    injected: InjectionRecord[];
    verified: VerifyResult[];
    /** Aggregated verification outcome. `passed: false` means at least one file failed verification. */
    verification: VerificationSummary;
    /** What the run did vs. skipped (scanned/injected/skipped/verify-failed). */
    coverage: CoverageSummary;
    /** Advisory placement plans (one per injected artifact) from the placement compiler. */
    placementPlans: PlacementPlan[];
    /** v3 nine-plane records (one per injected artifact), each with its semantic class. */
    metaV3: MetaV3Record[];
    /** LLM/IO hotpath metrics for this run: call counts, failures, p50/p95, decision paths. */
    metrics: MetricsSnapshot;
    /** Archives expanded in local-files mode (empty when `localFiles` is off). */
    archives: ArchiveRecord[];
}
export declare function runPipelineAsync(config: PipelineConfig): Promise<PipelineResult>;
