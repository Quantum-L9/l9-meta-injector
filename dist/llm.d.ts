export interface LlmAdapter {
    estimateTokens(text: string): number;
    classify?(prompt: string): Promise<string | null>;
}
export declare const localAdapter: LlmAdapter;
export declare function setAdapter(a: LlmAdapter): void;
export declare function getAdapter(): LlmAdapter;
export declare function resetAdapter(): void;
export type LlmCallOutcome = "ok" | "http_error" | "timeout" | "network_error" | "parse_error";
export interface LlmDiagnostic {
    outcome: LlmCallOutcome;
    status?: number;
    detail?: string;
    durationMs: number;
}
export declare function makeOpenAIAdapter(opts: {
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTokens?: number;
    timeout?: number;
    onDiagnostic?: (d: LlmDiagnostic) => void;
}): LlmAdapter;
