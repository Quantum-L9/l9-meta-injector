// llm.ts — LLM adapter. Local default makes NO external calls.
export interface LlmAdapter {
  estimateTokens(text: string): number;
  classify?(prompt: string): Promise<string | null>;
}

export const localAdapter: LlmAdapter = {
  estimateTokens(text: string): number { return Math.max(1, Math.ceil(text.length / 4)); },
  classify: undefined,
};

let _active: LlmAdapter = localAdapter;
export function setAdapter(a: LlmAdapter): void { _active = a; }
export function getAdapter(): LlmAdapter { return _active; }
export function resetAdapter(): void { _active = localAdapter; }

export function makeOpenAIAdapter(opts: {
  baseUrl: string; apiKey: string; model: string; maxTokens?: number; timeout?: number;
}): LlmAdapter {
  return {
    estimateTokens(text: string): number { return Math.max(1, Math.ceil(text.length / 4)); },
    async classify(prompt: string): Promise<string | null> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 15000);
      try {
        const res = await fetch(`${opts.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({ model: opts.model, messages: [{ role: "user", content: prompt }],
            max_tokens: opts.maxTokens ?? 80, temperature: 0 }),
          signal: ctrl.signal,
        });
        if (!res.ok) return null;
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        return data.choices?.[0]?.message?.content ?? null;
      } catch { return null; }
      finally { clearTimeout(timer); }
    },
  };
}
