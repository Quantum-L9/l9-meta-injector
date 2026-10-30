export interface LlmAdapter {
    estimateTokens(text: string): number;
    classify?(prompt: string): Promise<string | null>;
}
export declare const localAdapter: LlmAdapter;
export declare function setAdapter(a: LlmAdapter): void;
export declare function getAdapter(): LlmAdapter;
export declare function resetAdapter(): void;
/**
 * Run `body` with `adapter` as the adapter of this async context. Internal to the
 * runners; not re-exported from the `./advanced/llm` subpath.
 */
export declare function runWithAdapter<T>(adapter: LlmAdapter, body: () => Promise<T>): Promise<T>;
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
    /** Opt-in to send the bearer token over a non-https baseUrl (default: refuse). */
    allowInsecure?: boolean;
}): LlmAdapter;
