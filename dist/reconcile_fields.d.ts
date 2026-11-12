import { MetricsCollector } from "./metrics";
import { FieldDiff, MetaRecord } from "./schema";
export type { FieldDiff, ReconcileAction } from "./schema";
export interface ReconcileResult {
    merged: MetaRecord;
    diffs: FieldDiff[];
}
export declare function reconcileFieldsAsync(existing: MetaRecord, incoming: MetaRecord, metrics?: MetricsCollector): Promise<ReconcileResult>;
export declare function reconcileFields(existing: MetaRecord, incoming: MetaRecord): ReconcileResult;
export declare function diffsToLogYaml(filePath: string, diffs: FieldDiff[], timestamp: string): string;
