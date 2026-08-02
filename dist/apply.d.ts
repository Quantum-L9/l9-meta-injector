/** Governed carrier-aware whole-run transactional apply operation. */
import type { OperationResult } from "./operation_contracts";
import type { PipelineConfig } from "./schema";
export interface ApplyConfig extends Omit<PipelineConfig, "dryRun"> {
    dryRun?: false;
}
export declare function runApplyAsync(config: ApplyConfig): Promise<OperationResult>;
