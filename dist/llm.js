"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localAdapter = void 0;
exports.setAdapter = setAdapter;
exports.getAdapter = getAdapter;
exports.resetAdapter = resetAdapter;
exports.makeOpenAIAdapter = makeOpenAIAdapter;
exports.localAdapter = {
    estimateTokens(text) { return Math.max(1, Math.ceil(text.length / 4)); },
    classify: undefined,
};
let _active = exports.localAdapter;
function setAdapter(a) { _active = a; }
function getAdapter() { return _active; }
function resetAdapter() { _active = exports.localAdapter; }
function makeOpenAIAdapter(opts) {
    return {
        estimateTokens(text) { return Math.max(1, Math.ceil(text.length / 4)); },
        async classify(prompt) {
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
                if (!res.ok)
                    return null;
                const data = await res.json();
                return data.choices?.[0]?.message?.content ?? null;
            }
            catch {
                return null;
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
//# sourceMappingURL=llm.js.map