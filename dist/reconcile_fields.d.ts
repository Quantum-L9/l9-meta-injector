export type ReconcileAction = "add" | "revise" | "append-union" | "keep" | "replace";
export interface FieldDiff {
    field: string;
    action: ReconcileAction;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
}
export interface ReconcileResult {
    merged: Record<string, unknown>;
    diffs: FieldDiff[];
}
export declare function reconcileFieldsAsync(existing: Record<string, unknown>, incoming: Record<string, unknown>): Promise<ReconcileResult>;
export declare function reconcileFields(existing: Record<string, unknown>, incoming: Record<string, unknown>): ReconcileResult;
export declare function diffsToLogYaml(filePath: string, diffs: FieldDiff[], timestamp: string): string;
