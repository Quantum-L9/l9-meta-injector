export interface AssistConfig {
    enabled: boolean;
    proseFields: Array<"description" | "activation_signals" | "input_contract" | "output_contract">;
    materialityCheck: boolean;
}
export declare const DEFAULT_ASSIST_CONFIG: AssistConfig;
export declare function isGoodValue(v: unknown): boolean;
export declare const PROSE_ORIGIN_FIELDS: Set<string>;
export declare const GRAMMAR_ORIGIN_FIELDS: Set<string>;
export declare function assistField(fieldName: string, seedValue: unknown, body: string, config: AssistConfig): Promise<unknown>;
export declare function isMateriallyBetter(fieldName: string, oldValue: unknown, newValue: unknown, config: AssistConfig): Promise<boolean>;
