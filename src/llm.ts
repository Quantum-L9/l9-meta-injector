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

// Warn to stderr on any non-ok outcome so silent LLM degradation is never
// invisible — this fires regardless of whether a caller-supplied `onDiagnostic`
// is also present, because a metrics collector aggregates counts but does not
// itself surface the failure reason (status/detail) anywhere a human can see it.
// The caller-supplied callback still receives every outcome (incl. "ok") for
// metering. Never throws — diagnostics must not break the call path.
function reportDiagnostic(cb: ((d: LlmDiagnostic) => void) | undefined, d: LlmDiagnostic): void {
  if (cb) { try { cb(d); } catch { /* diagnostics must never break the caller */ } }
  if (d.outcome !== "ok") {
    const status = d.status !== undefined ? ` (status ${d.status})` : "";
    const detail = d.detail ? `: ${d.detail}` : "";
    process.stderr.write(`[l9-meta-injector] llm ${d.outcome}${status}${detail} [${d.durationMs}ms]\n`);
  }
}

// OpenAI's GPT-5 / o-series ("reasoning") models reject the legacy `max_tokens`
// and custom `temperature` chat-completions fields with a 400 unsupported_parameter
// error and require `max_completion_tokens` instead (temperature is fixed at 1).
// See: https://platform.openai.com/docs/guides/reasoning — detected by model-name
// prefix since the API does not expose a capability flag for this.
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o1|o3|o4)/i.test(model);
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
        const tokenLimit = opts.maxTokens ?? 80;
        const body: Record<string, unknown> = { model: opts.model, messages: [{ role: "user", content: prompt }] };
        if (isReasoningModel(opts.model)) {
          body.max_completion_tokens = tokenLimit;
        } else {
          body.max_tokens = tokenLimit;
          body.temperature = 0;
        }
        const res = await fetch(`${opts.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify(body),
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
