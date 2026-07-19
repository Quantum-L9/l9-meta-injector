// metrics.ts — opt-in, run-level counters/timings for the LLM + IO hotpaths.
//
// Addresses two findings:
//   OBS-009 (uncorrelated_signal): a heuristic/seed fallback must be recorded as
//     the path actually taken, not inferred after the fact from adapter presence —
//     so a FieldDiff reason can never claim "LLM judgment" when the LLM returned
//     null and the sync heuristic decided.
//   OBS-010 (no-metrics-on-hotpaths): makeOpenAIAdapter and the pipeline loops emit
//     no aggregate call/latency/failure signal. MetricsCollector aggregates the
//     per-call LlmDiagnostic stream into counts + p50/p95 and tallies inject IO.
//
// A MetricsCollector is threaded through a run. When a caller passes nothing the
// hot paths behave exactly as before — zero overhead, and no method here throws.

import { LlmDiagnostic } from "./llm";

// The genuine path a materiality / assist decision took. Recorded verbatim so a
// degraded LLM run is a first-class signal rather than a guess (OBS-009).
export type DecisionPath = "llm_ok" | "llm_failed_fallback" | "no_adapter" | "heuristic";

export interface MetricsSnapshot {
  llmCalls: number;
  llmFailures: number;
  llmLatencyP50Ms: number | null;
  llmLatencyP95Ms: number | null;
  decisionPaths: Record<DecisionPath, number>;
  injectedFiles: number;
}

const ZERO_PATHS = (): Record<DecisionPath, number> =>
  ({ llm_ok: 0, llm_failed_fallback: 0, no_adapter: 0, heuristic: 0 });

export class MetricsCollector {
  private latencies: number[] = [];
  private llmCalls = 0;
  private llmFailures = 0;
  private injectedFiles = 0;
  private paths: Record<DecisionPath, number> = ZERO_PATHS();

  // Drop-in `onDiagnostic` for makeOpenAIAdapter: aggregates every call outcome.
  // Bound so it can be passed by reference without losing `this`.
  readonly onLlmDiagnostic = (d: LlmDiagnostic): void => {
    this.llmCalls++;
    if (d.outcome !== "ok") this.llmFailures++;
    if (Number.isFinite(d.durationMs)) this.latencies.push(d.durationMs);
  };

  recordDecision(path: DecisionPath): void { this.paths[path]++; }
  recordInject(): void { this.injectedFiles++; }

  private percentile(p: number): number | null {
    if (this.latencies.length === 0) return null;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
  }

  snapshot(): MetricsSnapshot {
    return {
      llmCalls: this.llmCalls,
      llmFailures: this.llmFailures,
      llmLatencyP50Ms: this.percentile(50),
      llmLatencyP95Ms: this.percentile(95),
      decisionPaths: { ...this.paths },
      injectedFiles: this.injectedFiles,
    };
  }

  // A single compact line for the stderr run summary (mirrors the coverage line).
  formatLine(): string {
    const s = this.snapshot();
    const p = s.decisionPaths;
    const lat = s.llmLatencyP50Ms === null ? "n/a" : `p50=${s.llmLatencyP50Ms}ms p95=${s.llmLatencyP95Ms}ms`;
    return `llm-calls=${s.llmCalls} llm-failures=${s.llmFailures} ${lat} ` +
      `paths={llm_ok:${p.llm_ok},llm_failed_fallback:${p.llm_failed_fallback},` +
      `no_adapter:${p.no_adapter},heuristic:${p.heuristic}} injected=${s.injectedFiles}`;
  }
}

// Human-readable label for a decision path, embedded in FieldDiff.reason so the
// audit log itself carries the correlated signal (OBS-009).
export function decisionPathLabel(p: DecisionPath): string {
  switch (p) {
    case "llm_ok": return "LLM boolean judgment (llm_ok)";
    case "llm_failed_fallback": return "content-size heuristic (llm_failed_fallback)";
    case "no_adapter": return "content-size heuristic (no_adapter)";
    case "heuristic": return "content-size heuristic";
  }
}
