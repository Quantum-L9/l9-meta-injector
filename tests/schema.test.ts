import {
  UNKNOWN,
  PRIMITIVE_TAXONOMY,
  META_V3_PLANES,
  META_V3_SCHEMA_VERSION,
  MetaV3,
} from "../src/schema";
test("UNKNOWN constant", () => expect(UNKNOWN).toBe("Unknown"));
test("skill is callable", () => expect(PRIMITIVE_TAXONOMY.skill.callable).toBe(true));
test("skill mcp_primitive is tool", () => expect(PRIMITIVE_TAXONOMY.skill.mcpPrimitive).toBe("tool"));
test("doctrine is not callable", () => expect(PRIMITIVE_TAXONOMY.doctrine.callable).toBe(false));
test("test is not injectable", () => expect(PRIMITIVE_TAXONOMY.test.injectable).toBe(false));

// --- Metadata v3 — nine-plane schema ---------------------------------------

const SAMPLE_V3: MetaV3 = {
  identity: {
    id: "l9.example.skill",
    title: "Example Skill",
    artifact_type: "skill",
    content_hash: "a".repeat(64),
    version: "1.0.0",
  },
  taxonomy: {
    family: "builder",
    mcp_primitive: "tool",
    callable: true,
    retrievable: true,
    injectable: true,
  },
  placement: {
    namespace: "l9.example",
    source_path: "src/example.md",
    output_path: "dist/example.md",
    layer: "control_plane",
    sharing_scope: "shared",
  },
  routing: {
    advisory: true,
    activation_signals: ["build"],
    input_contract: "text/markdown",
    output_contract: "text/markdown",
    targets: ["compiler"],
  },
  provenance: {
    created_or_detected_at: "2026-01-01T00:00:00Z",
    generated_by: "l9-meta-injector",
    upstream: UNKNOWN,
    snapshot_hash: UNKNOWN,
  },
  governance: {
    authority: "Quantum-L9",
    status: "active",
    owner: "igorbeylin",
    decision_drivers: UNKNOWN,
  },
  economics: {
    token_cost_estimate: 128,
    size_bytes: 4096,
  },
  assurance: {
    validation_gates: ["typecheck", "test"],
    stop_conditions: UNKNOWN,
  },
  lineage: {
    schema_version: META_V3_SCHEMA_VERSION,
    supersedes: "l9.example.skill@0.9.0",
    chain: UNKNOWN,
  },
};

test("v3 declares exactly nine planes", () => expect(META_V3_PLANES.length).toBe(9));
test("v3 plane names are unique", () =>
  expect(new Set(META_V3_PLANES).size).toBe(META_V3_PLANES.length));
test("v3 canonical plane order", () =>
  expect([...META_V3_PLANES]).toEqual([
    "identity",
    "taxonomy",
    "placement",
    "routing",
    "provenance",
    "governance",
    "economics",
    "assurance",
    "lineage",
  ]));
test("v3 schema version is 3", () => expect(META_V3_SCHEMA_VERSION).toBe(3));
test("a v3 record carries every declared plane", () =>
  expect(META_V3_PLANES.every((p) => p in SAMPLE_V3)).toBe(true));
test("v3 record has no keys beyond the nine planes", () =>
  expect(Object.keys(SAMPLE_V3).sort()).toEqual([...META_V3_PLANES].sort()));
test("routing plane is advisory-only", () => expect(SAMPLE_V3.routing.advisory).toBe(true));
test("lineage schema_version matches the exported constant", () =>
  expect(SAMPLE_V3.lineage.schema_version).toBe(META_V3_SCHEMA_VERSION));
