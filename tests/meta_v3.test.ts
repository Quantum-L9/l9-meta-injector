import { buildMetaV3, hasAllPlanes } from "../src/meta_v3";
import { compilePlacementPlan } from "../src/placement_policy";
import { classifyArtifact } from "../src/artifact_class";
import { META_V3_PLANES, NormalizedMeta, UNKNOWN } from "../src/schema";

function sampleMeta(overrides: Partial<Record<string, unknown>> = {}): NormalizedMeta {
  const base = {
    id: "l9.skill.lint",
    title: "Lint",
    artifact_type: "skill",
    mcp_primitive: "tool",
    callable: true,
    retrievable: true,
    injectable: true,
    namespace: "l9",
    sharing_scope: "private",
    source_path: "skills/lint.md",
    content_hash: "abc123",
    token_cost_estimate: 42,
    authority: "l9.doctrine.platform",
    created_or_detected_at: "2026-07-17T00:00:00.000Z",
    family: "auditor",
    description: UNKNOWN,
    activation_signals: ["lint", "audit"],
    input_contract: UNKNOWN,
    output_contract: UNKNOWN,
    validation_gates: ["all findings have line numbers"],
    stop_conditions: ["error count > 100"],
    ...overrides,
  };
  return base as unknown as NormalizedMeta;
}

describe("buildMetaV3 — DWL-003 live producer", () => {
  test("produces a complete nine-plane record", () => {
    const meta = sampleMeta();
    const semantic = classifyArtifact("skills/lint.md");
    const v3 = buildMetaV3({ meta, semantic, sizeBytes: 128 });

    expect(hasAllPlanes(v3)).toBe(true);
    expect(Object.keys(v3).sort()).toEqual([...META_V3_PLANES].sort());
    expect(v3.identity.id).toBe("l9.skill.lint");
    expect(v3.taxonomy.family).toBe("auditor");
    expect(v3.taxonomy.mcp_primitive).toBe("tool");
    expect(v3.economics.token_cost_estimate).toBe(42);
    expect(v3.economics.size_bytes).toBe(128);
    expect(v3.assurance.validation_gates).toEqual(["all findings have line numbers"]);
    expect(v3.lineage.schema_version).toBe(3);
    expect(v3.routing.advisory).toBe(true);
  });

  test("threads the placement plan into the placement + routing planes (DWL-002)", () => {
    const meta = sampleMeta();
    const semantic = classifyArtifact("skills/lint.md");
    const placement = compilePlacementPlan("skills/lint.md", "", { namespace: "l9" });
    const v3 = buildMetaV3({ meta, semantic, placement });

    expect(v3.placement.output_path).toBe(placement.targetPath);
    expect(v3.placement.layer).toBe(placement.layer);
    expect(v3.routing.targets).toEqual([placement.targetDirectory]);
  });

  test("placement/routing fall back to Unknown when no plan is supplied", () => {
    const v3 = buildMetaV3({ meta: sampleMeta(), semantic: classifyArtifact("skills/lint.md") });
    expect(v3.placement.output_path).toBe(UNKNOWN);
    expect(v3.placement.layer).toBe(UNKNOWN);
    expect(v3.routing.targets).toBe(UNKNOWN);
  });

  test("works for a doctrine meta lacking exec fields (defensive field reads)", () => {
    const meta = sampleMeta({ artifact_type: "doctrine", family: undefined, owner: "platform-team", decision_drivers: ["scale"], activation_signals: undefined });
    const v3 = buildMetaV3({ meta, semantic: classifyArtifact("doctrines/policy.md") });
    expect(hasAllPlanes(v3)).toBe(true);
    expect(v3.taxonomy.family).toBe("Unknown");
    expect(v3.governance.owner).toBe("platform-team");
    expect(v3.governance.decision_drivers).toEqual(["scale"]);
    expect(v3.routing.activation_signals).toBe(UNKNOWN);
  });
});

describe("hasAllPlanes — idempotency/presence check", () => {
  test("true for a full record, false for partial or non-objects", () => {
    const full = buildMetaV3({ meta: sampleMeta(), semantic: classifyArtifact("skills/lint.md") });
    expect(hasAllPlanes(full)).toBe(true);
    const { lineage, ...missingOnePlane } = full;
    void lineage;
    expect(hasAllPlanes(missingOnePlane)).toBe(false);
    expect(hasAllPlanes(null)).toBe(false);
    expect(hasAllPlanes("nope")).toBe(false);
    expect(hasAllPlanes({})).toBe(false);
  });
});
