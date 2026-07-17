import { PipelineConfig, InjectionRecord, VerifyResult } from "./schema";
import { scanFiles } from "./retrieval";
import { PlacementPlan } from "./placement_policy";
import { MetaV3Record } from "./meta_v3";
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
export interface PipelineResult {
    scanned: ReturnType<typeof scanFiles>;
    injected: InjectionRecord[];
    verified: VerifyResult[];
    /** Aggregated verification outcome. `passed: false` means at least one file failed verification. */
    verification: VerificationSummary;
    /** Advisory placement plans (one per injected artifact) from the placement compiler. */
    placementPlans: PlacementPlan[];
    /** v3 nine-plane records (one per injected artifact), each with its semantic class. */
    metaV3: MetaV3Record[];
}
export declare function runPipelineAsync(config: PipelineConfig): Promise<PipelineResult>;
