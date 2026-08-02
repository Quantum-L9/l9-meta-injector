/** Read-only carrier-aware expected-versus-actual drift evaluation. */
import type { OperationResult } from "./operation_contracts";
import type { PipelineConfig } from "./schema";
export { CANONICAL_METADATA_WRITER } from "./carrier_operation";
export interface CheckConfig extends Omit<PipelineConfig, "dryRun"> {
    dryRun?: true;
}
export declare function runCheckAsync(config: CheckConfig): Promise<OperationResult>;
