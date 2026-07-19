// QTE-003 — buildMeta and serializeToYamlFrontMatter are central pure transforms
// previously exercised only transitively. Direct unit coverage: per-artifact_type
// field set + taxonomy, and the serializer's scalar quoting / escaping / empty-array
// handling.
import { buildMeta, serializeToYamlFrontMatter } from "../src/normalize_meta";
import { extract } from "../src/extract";
import { ClassifyResult, ExtractedFields, NormalizedMeta, UNKNOWN, PRIMITIVE_TAXONOMY, asRecord } from "../src/schema";
import { NamespaceConfig } from "../src/namespace";

const NS: NamespaceConfig = {
  namespace: "l9", authority: "l9.auto", nearDupThreshold: 0.9, hashPrefixLength: 16,
  outputDir: ".", indexDir: ".",
};
const NOW = "2026-07-19T00:00:00.000Z";

function cr(artifactType: ClassifyResult["artifactType"], family: ClassifyResult["family"] = "Unknown"): ClassifyResult {
  return { artifactType, family, signals: [], confidence: "low" };
}
function ef(): ExtractedFields { return extract(""); }

// The identity block every variant must carry.
const BASE_KEYS = [
  "id", "title", "artifact_type", "mcp_primitive", "callable", "retrievable",
  "injectable", "namespace", "sharing_scope", "source_path", "content_hash",
  "token_cost_estimate", "authority", "created_or_detected_at",
];

describe("QTE-003 — buildMeta emits the correct field set + taxonomy per type", () => {
  test("prompt carries the full prompt schema and prompt taxonomy", () => {
    const m = asRecord(buildMeta("prompts/Prompt-Foo.md", "body text here", ef(), cr("prompt", "planner"), NS, "l9.auto", NOW));
    for (const k of [...BASE_KEYS, "role", "objective", "input_variables", "output_format",
      "model_target", "constraints", "phase_model", "description", "activation_signals",
      "input_contract", "output_contract", "validation_gates", "stop_conditions"]) {
      expect(m).toHaveProperty(k);
    }
    expect(m.artifact_type).toBe("prompt");
    const tax = PRIMITIVE_TAXONOMY["prompt"];
    expect(m.mcp_primitive).toBe(tax.mcpPrimitive);
    expect(m.callable).toBe(tax.callable);
  });

  test("doctrine carries governs/decision_drivers and NOT the executable fields", () => {
    const m = asRecord(buildMeta("doctrines/x.md", "b", ef(), cr("doctrine"), NS, "l9.auto", NOW));
    expect(m).toHaveProperty("governs");
    expect(m).toHaveProperty("decision_drivers");
    expect(m).toHaveProperty("applies_to_domains");
    expect(m).not.toHaveProperty("role");
    expect(m).not.toHaveProperty("validation_gates");
  });

  test("source/test/script get the artifact shape (owner only)", () => {
    for (const t of ["source", "test", "script"] as const) {
      const m = asRecord(buildMeta(`x.${t}.ts`, "b", ef(), cr(t), NS, "l9.auto", NOW));
      expect(m).toHaveProperty("owner");
      expect(m.owner).toBe(UNKNOWN);
      expect(m).not.toHaveProperty("role");
      expect(m.artifact_type).toBe(t);
    }
  });

  test("token_cost_estimate is a number and content_hash is populated", () => {
    const m = buildMeta("skills/s.md", "some body", ef(), cr("skill", "builder"), NS, "l9.auto", NOW);
    expect(typeof m.token_cost_estimate).toBe("number");
    expect(typeof m.content_hash).toBe("string");
    expect(m.content_hash.length).toBeGreaterThan(0);
  });
});

describe("QTE-003 — serializeToYamlFrontMatter quoting / escaping / empty arrays", () => {
  function serializeMeta(extra: Record<string, unknown>): string {
    const base = buildMeta("skills/s.md", "b", ef(), cr("skill", "builder"), NS, "l9.auto", NOW);
    return serializeToYamlFrontMatter({ ...base, ...extra } as NormalizedMeta);
  }

  test("wraps and delimits with --- fences", () => {
    const out = serializeMeta({});
    expect(out.startsWith("---\n")).toBe(true);
    expect(out.endsWith("\n---")).toBe(true);
  });

  test("a value with a colon is double-quoted", () => {
    const out = serializeMeta({ description: "a: b" });
    expect(out).toContain('description: "a: b"');
  });

  test("a value with an embedded double-quote is escaped", () => {
    const out = serializeMeta({ description: 'say "hi"' });
    expect(out).toContain('description: "say \\"hi\\""');
  });

  test("an empty array serializes as [] on one line", () => {
    const out = serializeMeta({ activation_signals: [] });
    expect(out).toContain("activation_signals: []");
  });

  test("a populated array serializes as a block list", () => {
    const out = serializeMeta({ activation_signals: ["alpha", "beta"] });
    expect(out).toMatch(/activation_signals:\n {2}- alpha\n {2}- beta/);
  });

  test("booleans and numbers serialize bare (unquoted)", () => {
    const out = serializeMeta({});
    expect(out).toMatch(/callable: (true|false)/);
    expect(out).toMatch(/token_cost_estimate: \d+/);
  });
});
