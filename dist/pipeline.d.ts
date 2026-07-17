import { PipelineConfig, InjectionRecord, VerifyResult } from "./schema";
import { scanFiles } from "./retrieval";
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
}
export declare function runPipelineAsync(config: PipelineConfig): Promise<PipelineResult>;
