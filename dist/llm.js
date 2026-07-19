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
// Default sink: warn to stderr on any non-ok outcome so silent LLM degradation is
// visible. A caller-supplied `onDiagnostic` receives every outcome (incl. "ok") for
// metering. Never throws — diagnostics must not break the call path.
function reportDiagnostic(cb, d) {
    if (cb) {
        try {
            cb(d);
        }
        catch { /* diagnostics must never break the caller */ }
        return;
    }
    if (d.outcome !== "ok") {
        const status = d.status !== undefined ? ` (status ${d.status})` : "";
        const detail = d.detail ? `: ${d.detail}` : "";
        process.stderr.write(`[l9-meta-injector] llm ${d.outcome}${status}${detail} [${d.durationMs}ms]\n`);
    }
}
function makeOpenAIAdapter(opts) {
    return {
        estimateTokens(text) { return Math.max(1, Math.ceil(text.length / 4)); },
        async classify(prompt) {
            const ctrl = new AbortController();
            const started = Date.now();
            const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 15000);
            const emit = (d) => reportDiagnostic(opts.onDiagnostic, d);
            try {
                // Never transmit the Authorization bearer over cleartext (SEC-003 / CWE-319).
                if (!/^https:/i.test(opts.baseUrl) && !opts.allowInsecure) {
                    emit({ outcome: "network_error", detail: "refusing to send credential to non-https baseUrl", durationMs: Date.now() - started });
                    return null;
                }
                const res = await fetch(`${opts.baseUrl}/chat/completions`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
                    body: JSON.stringify({ model: opts.model, messages: [{ role: "user", content: prompt }],
                        max_tokens: opts.maxTokens ?? 80, temperature: 0 }),
                    signal: ctrl.signal,
                });
                if (!res.ok) {
                    let body = "";
                    try {
                        body = (await res.text()).slice(0, 200);
                    }
                    catch { /* body unreadable */ }
                    emit({ outcome: "http_error", status: res.status, detail: body || undefined, durationMs: Date.now() - started });
                    return null;
                }
                let data;
                try {
                    data = await res.json();
                }
                catch (e) {
                    emit({ outcome: "parse_error", status: res.status, detail: e?.message, durationMs: Date.now() - started });
                    return null;
                }
                const content = data.choices?.[0]?.message?.content ?? null;
                emit({ outcome: "ok", status: res.status, durationMs: Date.now() - started });
                return content;
            }
            catch (e) {
                const err = e;
                const outcome = err?.name === "AbortError" ? "timeout" : "network_error";
                emit({ outcome, detail: err?.message, durationMs: Date.now() - started });
                return null;
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
//# sourceMappingURL=llm.js.map