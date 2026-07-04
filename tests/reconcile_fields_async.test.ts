import { reconcileFieldsAsync } from "../src/reconcile_fields";
import { UNKNOWN } from "../src/schema";
import { setAdapter, resetAdapter } from "../src/llm";

afterEach(() => resetAdapter());

describe("reconcileFieldsAsync — LLM boolean for description/intent", () => {
  it("calls LLM for description field when adapter.classify is wired", async () => {
    let calls: string[] = [];
    setAdapter({
      estimateTokens: () => 1,
      classify: async (prompt) => { calls.push(prompt); return "yes"; }
    });
    const existing = { description: "Processes documents in some basic way and outputs results for users." };
    const incoming = { description: "Processes and normalizes documents into structured JSON for retrieval." };
    const { merged, diffs } = await reconcileFieldsAsync(existing, incoming);
    expect(calls.some((c) => c.includes("description"))).toBe(true);
    expect(merged.description).toBe(incoming.description);
    expect(diffs[0].action).toBe("revise");
    expect(diffs[0].reason).toContain("LLM boolean judgment");
  });

  it("keeps old when LLM returns no", async () => {
    setAdapter({ estimateTokens: () => 1, classify: async () => "no" });
    const existing = { description: "Processes documents into structured JSON output for retrieval pipeline." };
    const incoming = { description: "Does similar stuff." };
    const { merged, diffs } = await reconcileFieldsAsync(existing, incoming);
    expect(merged.description).toBe(existing.description);
    expect(diffs[0].action).toBe("keep");
  });

  it("falls back to sync heuristic for non-prose-scalar fields (e.g. title)", async () => {
    let called = false;
    setAdapter({ estimateTokens: () => 1, classify: async () => { called = true; return "yes"; } });
    const existing = { title: "Old Title" };
    const incoming = { title: "New Title That Is Much Longer And Contains More Specific Information About The Artifact Domain Area" };
    await reconcileFieldsAsync(existing, incoming);
    // title is not in LLM_MATERIALITY_FIELDS — should NOT call LLM
    expect(called).toBe(false);
  });

  it("list fields still union without LLM call", async () => {
    let called = false;
    setAdapter({ estimateTokens: () => 1, classify: async () => { called = true; return "yes"; } });
    const existing = { triggers: ["text chunking", "split doc"] };
    const incoming = { triggers: ["retrieval prep", "text chunking"] };
    const { merged } = await reconcileFieldsAsync(existing, incoming);
    expect(called).toBe(false); // no LLM call for list fields
    expect((merged.triggers as string[])).toContain("retrieval prep");
    expect((merged.triggers as string[]).filter(s => s === "text chunking").length).toBe(1);
  });

  it("replace on deprecated without LLM regardless", async () => {
    setAdapter({ estimateTokens: () => 1, classify: async () => "no" }); // LLM says no — but replace wins
    const { diffs } = await reconcileFieldsAsync({ deprecated: true, description: "Old." }, { description: "New." });
    expect(diffs.find(d => d.field === "description")?.action).toBe("replace");
  });
});

describe("reconcileFieldsAsync — .txt / prose files (no frontmatter)", () => {
  it("adds all fields when existing is empty (first injection on .txt)", async () => {
    const { diffs } = await reconcileFieldsAsync({}, { namespace: "l9", artifact_type: "context", description: UNKNOWN });
    expect(diffs.every(d => d.action === "add")).toBe(true);
  });
});
