export interface LlmAdapter {
    estimateTokens(text: string): number;
    classify?(prompt: string): Promise<string | null>;
}
export declare const localAdapter: LlmAdapter;
export declare function setAdapter(a: LlmAdapter): void;
export declare function getAdapter(): LlmAdapter;
export declare function resetAdapter(): void;
export declare function makeOpenAIAdapter(opts: {
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTokens?: number;
    timeout?: number;
}): LlmAdapter;
