import { MetricsCollector } from "./metrics";
export interface AssistConfig {
    enabled: boolean;
    proseFields: Array<"description" | "activation_signals" | "input_contract" | "output_contract">;
    /** When true, description assist uses the Cursor Agent Skill prompt (Use when …). */
    cursorSkillDescription?: boolean;
}
export declare const DEFAULT_ASSIST_CONFIG: AssistConfig;
export declare function isGoodValue(v: unknown): boolean;
/** Cursor-native descriptions should include explicit "use when" trigger language. */
export declare function hasUseWhenSignal(description: unknown): boolean;
export declare const PROSE_ORIGIN_FIELDS: Set<string>;
export declare const GRAMMAR_ORIGIN_FIELDS: Set<string>;
export declare function assistField(fieldName: string, seedValue: unknown, body: string, config: AssistConfig, metrics?: MetricsCollector): Promise<unknown>;
