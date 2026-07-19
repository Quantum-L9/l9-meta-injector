import { LlmDiagnostic } from "./llm";
export type DecisionPath = "llm_ok" | "llm_failed_fallback" | "no_adapter" | "heuristic";
export interface MetricsSnapshot {
    llmCalls: number;
    llmFailures: number;
    llmLatencyP50Ms: number | null;
    llmLatencyP95Ms: number | null;
    decisionPaths: Record<DecisionPath, number>;
    injectedFiles: number;
}
export declare class MetricsCollector {
    private latencies;
    private llmCalls;
    private llmFailures;
    private injectedFiles;
    private paths;
    readonly onLlmDiagnostic: (d: LlmDiagnostic) => void;
    recordDecision(path: DecisionPath): void;
    recordInject(): void;
    private percentile;
    snapshot(): MetricsSnapshot;
    formatLine(): string;
}
export declare function decisionPathLabel(p: DecisionPath): string;
