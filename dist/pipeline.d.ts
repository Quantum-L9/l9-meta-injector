import { PipelineConfig, InjectionRecord, VerifyResult } from "./schema";
import { scanFiles } from "./retrieval";
export interface PipelineResult {
    scanned: ReturnType<typeof scanFiles>;
    injected: InjectionRecord[];
    verified: VerifyResult[];
}
export declare function runPipelineAsync(config: PipelineConfig): Promise<PipelineResult>;
