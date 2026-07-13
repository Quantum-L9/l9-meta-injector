import {
  classifyArtifact,
  isSemanticArtifactClass,
  SEMANTIC_ARTIFACT_CLASSES,
} from "../src/artifact_class";
import { SemanticArtifactClass } from "../src/schema";
import { classifyWithSemantics } from "../src/classify";

test("exactly 17 semantic classes", () => expect(SEMANTIC_ARTIFACT_CLASSES.length).toBe(17));

test("semantic classes are unique", () =>
  expect(new Set(SEMANTIC_ARTIFACT_CLASSES).size).toBe(SEMANTIC_ARTIFACT_CLASSES.length));

test("classifyArtifact never throws on a bare filename", () =>
  expect(() => classifyArtifact("a.ts")).not.toThrow());

test.each<[string, SemanticArtifactClass]>([
  ["src/inject.ts", "source_module"],
  ["dist/schema.d.ts", "type_definitions"],
  ["tests/schema.test.ts", "test_suite"],
  ["schemas/l9_meta_v3.schema.yaml", "schema"],
  ["tsconfig.json", "configuration"],
  ["docs/architecture.md", "documentation"],
  ["docs/contracts.md", "contract"],
  ["package.json", "build_manifest"],
  ["dist/index.js", "build_artifact"],
  ["examples/sample.md", "fixture"],
  ["scripts/preflight.sh", "script"],
  ["src/pipeline.ts", "pipeline"],
  ["prompts/prompt-intro.md", "prompt_template"],
  ["skills/l9.skill.foo.md", "skill_definition"],
  ["doctrines/policy.md", "governance_doctrine"],
  ["CHANGELOG.md", "changelog"],
  ["binary.bin", "unknown"],
])("%s -> %s", (p, expected) =>
  expect(classifyArtifact(p).artifactClass).toBe(expected)
);

test("a 'manifest' doc is documentation, not build_manifest (order sensitivity)", () =>
  expect(classifyArtifact("docs/manifest.md").artifactClass).toBe("documentation"));

test("build_artifact signal reflects the matched segment (/build/ not /dist/)", () =>
  expect(classifyArtifact("build/out.js").signals).toContain("/build/"));

test("d.ts wins over source_module (order sensitivity)", () =>
  expect(classifyArtifact("src/types.d.ts").artifactClass).toBe("type_definitions"));

test("test file wins over source_module", () =>
  expect(classifyArtifact("src/foo.spec.ts").artifactClass).toBe("test_suite"));

test("every rule result is a known class with a confidence", () => {
  const r = classifyArtifact("src/inject.ts");
  expect(isSemanticArtifactClass(r.artifactClass)).toBe(true);
  expect(["high", "medium", "low"]).toContain(r.confidence);
});

test("isSemanticArtifactClass rejects unknown strings", () =>
  expect(isSemanticArtifactClass("not_a_class")).toBe(false));

test("unknown class carries low confidence and no signals", () => {
  const r = classifyArtifact("mystery.qzx");
  expect(r.artifactClass).toBe("unknown");
  expect(r.confidence).toBe("low");
  expect(r.signals).toEqual([]);
});

test("classifyWithSemantics is additive: preserves coarse fields + adds semantic", () => {
  const r = classifyWithSemantics("src/foo.test.ts", "describe('x', () => {})", "none");
  expect(r).toHaveProperty("artifactType");
  expect(r).toHaveProperty("family");
  expect(r.semantic.artifactClass).toBe("test_suite");
});
