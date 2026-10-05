import { reconcileFields, diffsToLogYaml } from "../src/reconcile_fields";
import { UNKNOWN } from "../src/schema";

describe("add", () => {
  it("adds field not in existing", () => {
    const { merged, diffs } = reconcileFields({}, { namespace: "l9" });
    expect(merged.namespace).toBe("l9");
    expect(diffs[0].action).toBe("add");
  });
});

describe("keep", () => {
  it("keeps good existing value when incoming is worse", () => {
    const existing = { description: "Processes and normalizes documents into structured retrieval-ready JSON chunks with metadata and offset tracking." };
    const { merged, diffs } = reconcileFields(existing, { description: "Does stuff." });
    expect(merged.description).toBe(existing.description);
    expect(diffs[0].action).toBe("keep");
  });

  it("keeps when both Unknown", () => {
    const { diffs } = reconcileFields({ description: UNKNOWN }, { description: UNKNOWN });
    expect(diffs[0].action).toBe("keep");
  });
});

describe("derived fields", () => {
  it("replaces a stale id, source_path, content_hash, and token estimate", () => {
    const existing = { id: "l9.source.index", source_path: "index.ts", content_hash: "old", token_cost_estimate: 1, description: "keep me" };
    const incoming = { id: "l9.source.src_index__ts", source_path: "src/index.ts", content_hash: "new", token_cost_estimate: 2, description: "shorter" };
    const { merged, diffs } = reconcileFields(existing, incoming);
    expect(merged.id).toBe(incoming.id);
    expect(merged.source_path).toBe(incoming.source_path);
    expect(merged.content_hash).toBe("new");
    expect(merged.token_cost_estimate).toBe(2);
    expect(merged.description).toBe(existing.description);
    expect(diffs.filter((d) => d.field === "id")[0]).toMatchObject({ action: "revise", reason: "derived field recomputed" });
  });

  it("keeps a derived field when the incoming value is equal", () => {
    const { diffs } = reconcileFields({ id: "same" }, { id: "same" });
    expect(diffs[0]).toMatchObject({ action: "keep", reason: "derived field recomputed" });
  });
});

describe("revise", () => {
  it("revises when incoming is materially better (>20% larger)", () => {
    const existing = { description: "Does stuff." };
    const incoming = { description: "Processes and normalizes documents into structured retrieval-ready JSON chunks with offset tracking for downstream indexing and search pipelines." };
    const { merged, diffs } = reconcileFields(existing, incoming);
    expect(merged.description).toBe(incoming.description);
    expect(diffs[0].action).toBe("revise");
  });
});

describe("append-union", () => {
  it("unions list fields and deduplicates", () => {
    const existing = { activation_signals: ["text chunking", "split document"] };
    const incoming = { activation_signals: ["retrieval prep", "text chunking"] };
    const { merged, diffs } = reconcileFields(existing, incoming);
    const signals = merged.activation_signals as string[];
    expect(signals).toContain("text chunking");
    expect(signals).toContain("split document");
    expect(signals).toContain("retrieval prep");
    expect(signals.filter((s) => s === "text chunking")).toHaveLength(1);
    expect(diffs[0].action).toBe("append-union");
  });
});

describe("replace on deprecation", () => {
  it("replaces when deprecated:true", () => {
    const { merged, diffs } = reconcileFields({ deprecated: true, description: "Old." }, { description: "New." });
    expect(merged.description).toBe("New.");
    expect(diffs.find((d) => d.field === "description")?.action).toBe("replace");
  });
  it("replaces when superseded_by is set", () => {
    const { merged } = reconcileFields({ superseded_by: "new.skill.better", description: "Old." }, { description: "Replacement." });
    expect(merged.description).toBe("Replacement.");
  });
});

test("diffsToLogYaml produces parseable YAML structure", () => {
  const { diffs } = reconcileFields({ x: "short" }, { x: "A much longer and materially more complete replacement value for this artifact field in the system." });
  const yaml = diffsToLogYaml("test.md", diffs, "2026-06-19T00:00:00Z");
  expect(yaml).toContain('file: "test.md"');
  expect(yaml).toContain("action:");
  expect(yaml).toContain("reason:");
});
