// OBS-009 / OBS-010 — MetricsCollector aggregates the LLM/IO hotpath signal and the
// TRUE decision path (never inferred from adapter presence). Plus ICC-005 —
// normalizeMetaRecord coerces the typed BaseHeader fields at the reconcile edge.
import { MetricsCollector, decisionPathLabel } from "../src/metrics";
import { reconcileFieldsAsync } from "../src/reconcile_fields";
import { setAdapter, resetAdapter, LlmDiagnostic } from "../src/llm";
import { normalizeMetaRecord } from "../src/schema";

afterEach(() => resetAdapter());

describe("OBS-010 — MetricsCollector aggregates calls / failures / latency", () => {
  test("onLlmDiagnostic counts calls and failures and computes percentiles", () => {
    const m = new MetricsCollector();
    const diag = (o: LlmDiagnostic["outcome"], ms: number): LlmDiagnostic => ({ outcome: o, durationMs: ms });
    [diag("ok", 10), diag("ok", 20), diag("http_error", 30), diag("timeout", 40)].forEach(m.onLlmDiagnostic);
    const s = m.snapshot();
    expect(s.llmCalls).toBe(4);
    expect(s.llmFailures).toBe(2);
    expect(s.llmLatencyP50Ms).not.toBeNull();
    expect(s.llmLatencyP95Ms).toBeGreaterThanOrEqual(s.llmLatencyP50Ms!);
  });

  test("empty collector reports null percentiles and zero counts", () => {
    const s = new MetricsCollector().snapshot();
    expect(s.llmCalls).toBe(0);
    expect(s.llmLatencyP50Ms).toBeNull();
    expect(s.injectedFiles).toBe(0);
  });

  test("recordInject and recordDecision tally", () => {
    const m = new MetricsCollector();
    m.recordInject(); m.recordInject();
    m.recordDecision("llm_ok"); m.recordDecision("heuristic");
    const s = m.snapshot();
    expect(s.injectedFiles).toBe(2);
    expect(s.decisionPaths.llm_ok).toBe(1);
    expect(s.decisionPaths.heuristic).toBe(1);
  });
});

describe("OBS-009 — the recorded path reflects reality, not adapter presence", () => {
  test("when classify returns null, the path is llm_failed_fallback (not llm_ok)", async () => {
    setAdapter({ estimateTokens: () => 1, classify: async () => null });
    const m = new MetricsCollector();
    // Both values are "good" (>=8 words) so the trivial guards are bypassed and the
    // adapter is actually consulted; it returns null, so the recorded path must show
    // the LLM was consulted and fell back to the heuristic.
    const existing = { description: "Processes documents in some basic and unremarkable way for the users of the system." };
    const incoming = { description: "A materially longer and more specific description of the artifact behavior for the retrieval pipeline." };
    const { diffs } = await reconcileFieldsAsync(existing, incoming, m);
    const d = diffs.find((x) => x.field === "description")!;
    expect(d.reason).toContain("llm_failed_fallback");
    expect(m.snapshot().decisionPaths.llm_failed_fallback).toBe(1);
    expect(m.snapshot().decisionPaths.llm_ok).toBe(0);
  });

  test("when classify returns yes, the path is llm_ok and the reason says so", async () => {
    setAdapter({ estimateTokens: () => 1, classify: async () => "yes" });
    const m = new MetricsCollector();
    const existing = { description: "Processes documents in some basic way for the users of the system." };
    const incoming = { description: "Normalizes documents into structured JSON for the retrieval pipeline end to end." };
    const { diffs } = await reconcileFieldsAsync(existing, incoming, m);
    const d = diffs.find((x) => x.field === "description")!;
    expect(d.reason).toContain("llm_ok");
    expect(d.reason).toContain("LLM boolean judgment"); // back-compat substring
    expect(m.snapshot().decisionPaths.llm_ok).toBe(1);
  });

  test("no adapter → path is no_adapter", async () => {
    resetAdapter(); // local adapter has no classify
    const m = new MetricsCollector();
    const { diffs } = await reconcileFieldsAsync(
      { description: "Old but decent description of the thing being processed here now." },
      { description: "New but similarly sized description of the thing being processed here." },
      m,
    );
    // description is a materiality field; with no adapter the path is no_adapter.
    expect(m.snapshot().decisionPaths.no_adapter).toBe(1);
    expect(diffs.find((x) => x.field === "description")!.reason).toContain("no_adapter");
  });

  test("decisionPathLabel maps every path to a stable string", () => {
    expect(decisionPathLabel("llm_ok")).toContain("llm_ok");
    expect(decisionPathLabel("heuristic")).toBe("content-size heuristic");
  });
});

describe("ICC-005 — normalizeMetaRecord coerces typed BaseHeader fields", () => {
  test("string numbers/booleans become numbers/booleans; other keys untouched", () => {
    const out = normalizeMetaRecord({
      token_cost_estimate: "42", callable: "false", retrievable: "true", injectable: "true",
      description: "stays a string", namespace: "l9",
    });
    expect(out.token_cost_estimate).toBe(42);
    expect(out.callable).toBe(false);
    expect(out.retrievable).toBe(true);
    expect(out.description).toBe("stays a string");
    expect(out.namespace).toBe("l9");
  });

  test("already-typed values pass through unchanged (idempotent)", () => {
    const input = { token_cost_estimate: 7, callable: true };
    const out = normalizeMetaRecord(input);
    expect(out.token_cost_estimate).toBe(7);
    expect(out.callable).toBe(true);
    // does not mutate the input object
    expect(input.token_cost_estimate).toBe(7);
  });

  test("non-numeric string is left alone (no NaN coercion)", () => {
    const out = normalizeMetaRecord({ token_cost_estimate: "Unknown" });
    expect(out.token_cost_estimate).toBe("Unknown");
  });
});
