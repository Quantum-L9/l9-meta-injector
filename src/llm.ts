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

// Outcome of a single LLM call. `classify` still returns `string | null` for the
// adapter contract, but the outcome is reported separately so a failure (timeout,
// http_error, parse_error) is never indistinguishable from a legitimate null.
export type LlmCallOutcome = "ok" | "http_error" | "timeout" | "network_error" | "parse_error";

export interface LlmDiagnostic {
  outcome: LlmCallOutcome;
  status?: number;
  detail?: string;
  durationMs: number;
}

// Default sink: warn to stderr on any non-ok outcome so silent LLM degradation is
// visible. A caller-supplied `onDiagnostic` receives every outcome (incl. "ok") for
// metering. Never throws — diagnostics must not break the call path.
function reportDiagnostic(cb: ((d: LlmDiagnostic) => void) | undefined, d: LlmDiagnostic): void {
  if (cb) { try { cb(d); } catch { /* diagnostics must never break the caller */ } return; }
  if (d.outcome !== "ok") {
    const status = d.status !== undefined ? ` (status ${d.status})` : "";
    const detail = d.detail ? `: ${d.detail}` : "";
    process.stderr.write(`[l9-meta-injector] llm ${d.outcome}${status}${detail} [${d.durationMs}ms]\n`);
  }
}

export function makeOpenAIAdapter(opts: {
  baseUrl: string; apiKey: string; model: string; maxTokens?: number; timeout?: number;
  onDiagnostic?: (d: LlmDiagnostic) => void;
  /** Opt-in to send the bearer token over a non-https baseUrl (default: refuse). */
  allowInsecure?: boolean;
}): LlmAdapter {
  return {
    estimateTokens(text: string): number { return Math.max(1, Math.ceil(text.length / 4)); },
    async classify(prompt: string): Promise<string | null> {
      const ctrl = new AbortController();
      const started = Date.now();
      const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 15000);
      const emit = (d: LlmDiagnostic) => reportDiagnostic(opts.onDiagnostic, d);
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
          try { body = (await res.text()).slice(0, 200); } catch { /* body unreadable */ }
          emit({ outcome: "http_error", status: res.status, detail: body || undefined, durationMs: Date.now() - started });
          return null;
        }
        let data: { choices?: Array<{ message?: { content?: string } }> };
        try {
          data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        } catch (e) {
          emit({ outcome: "parse_error", status: res.status, detail: (e as Error)?.message, durationMs: Date.now() - started });
          return null;
        }
        const content = data.choices?.[0]?.message?.content ?? null;
        emit({ outcome: "ok", status: res.status, durationMs: Date.now() - started });
        return content;
      } catch (e) {
        const err = e as Error;
        const outcome: LlmCallOutcome = err?.name === "AbortError" ? "timeout" : "network_error";
        emit({ outcome, detail: err?.message, durationMs: Date.now() - started });
        return null;
      } finally { clearTimeout(timer); }
    },
  };
}
