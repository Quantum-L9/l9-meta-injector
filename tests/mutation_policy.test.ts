import {
  assertCarrierDecisionCoverage,
  resolveCarrierDecision,
  resolveCarrierDecisions,
  type CarrierSubject,
} from "../src/mutation_policy";
import {
  META_AUTHORITY_SCHEMA,
  isAuthorityConfig,
  type AuthorityConfig,
} from "../src/operation_contracts";

const authority: AuthorityConfig = {
  schema: META_AUTHORITY_SCHEMA,
  writer: { repository: "Quantum-L9/l9-meta-injector", ref: "v4.0.0" },
  default_carrier: "central_manifest",
  legacy_writers: "forbidden",
  inline_allow: [
    "prompts/**",
    "skills/**/SKILL.md",
    "doctrines/*.md",
    "kernels/**",
  ],
};

function subject(path: string, artifactType: CarrierSubject["artifactType"], strategy: CarrierSubject["strategy"]): CarrierSubject {
  return { path, artifactType, strategy };
}

describe("explicit metadata carrier policy", () => {
  test.each([
    [".git/config", "source", "line-comment"],
    [".l9/metadata-index.jsonl", "source", "sidecar"],
    ["node_modules/pkg/index.js", "source", "line-comment"],
    ["asset.png", "source", "skip-binary"],
    ["notes.md.l9meta.yaml", "source", "line-comment"],
    ["run.inject.log", "source", "sidecar"],
  ] as const)("hard-skips protected or binary path %s", (filePath, artifactType, strategy) => {
    expect(resolveCarrierDecision(subject(filePath, artifactType, strategy), authority, "apply").carrier).toBe("hard_skip");
  });

  test.each([
    ["dist/index.js", "source", "line-comment"],
    ["coverage/report.json", "source", "sidecar"],
    ["vendor/lib.py", "source", "line-comment"],
    ["package-lock.json", "source", "sidecar"],
    ["public/app.min.js", "source", "line-comment"],
    ["public/app.js.map", "source", "sidecar"],
  ] as const)("inventories generated or externally managed path %s", (filePath, artifactType, strategy) => {
    expect(resolveCarrierDecision(subject(filePath, artifactType, strategy), authority, "apply").carrier).toBe("inventory_only");
  });

  test.each([
    ["src/app.ts", "source", "line-comment"],
    ["tests/app.test.ts", "test", "line-comment"],
    [".github/workflows/ci.yml", "source", "line-comment"],
    ["infra/main.tf", "source", "line-comment"],
    ["package.json", "source", "sidecar"],
    ["data/schema.json", "context", "sidecar"],
    ["docs/reference.rst", "context", "yaml-frontmatter"],
  ] as const)("routes source/config/control path %s to central manifest", (filePath, artifactType, strategy) => {
    expect(resolveCarrierDecision(subject(filePath, artifactType, strategy), authority, "check").carrier).toBe("central_manifest");
  });

  test.each([
    ["prompts/release.md", "prompt"],
    ["skills/github/SKILL.md", "skill"],
    ["doctrines/safety.md", "doctrine"],
    ["kernels/change/CHANGE.md", "kernel"],
  ] as const)("allows explicit managed prose path %s inline", (filePath, artifactType) => {
    expect(resolveCarrierDecision(subject(filePath, artifactType, "yaml-frontmatter"), authority, "apply").carrier).toBe("inline_managed");
  });

  test("an allow pattern cannot force source code inline", () => {
    const broad = { ...authority, inline_allow: ["**"] };
    expect(resolveCarrierDecision(subject("src/app.ts", "source", "line-comment"), broad, "apply").carrier).toBe("central_manifest");
  });

  test("an allow pattern cannot force generic documentation inline", () => {
    const broad = { ...authority, inline_allow: ["docs/**"] };
    expect(resolveCarrierDecision(subject("docs/README.md", "unknown", "yaml-frontmatter"), broad, "apply").carrier).toBe("central_manifest");
  });

  test("default inline_managed still requires explicit allow", () => {
    const inlineDefault: AuthorityConfig = { ...authority, default_carrier: "inline_managed", inline_allow: [] };
    const result = resolveCarrierDecision(subject("prompts/release.md", "prompt", "yaml-frontmatter"), inlineDefault, "apply");
    expect(result.carrier).toBe("central_manifest");
    expect(result.reason).toContain("requires an explicit");
  });

  test("skills mode does not bypass explicit inline authority", () => {
    const none: AuthorityConfig = { ...authority, inline_allow: [] };
    expect(resolveCarrierDecision(subject("skills/github/SKILL.md", "skill", "yaml-frontmatter"), none, "skills").carrier).toBe("central_manifest");
  });

  test.each([
    "/absolute/**",
    "../escape/**",
    "prompts/../secrets/**",
    "!prompts/**",
    "prompts\\**",
    "./prompts/**",
    "prompts//**",
  ])("rejects unsafe inline_allow pattern %s", (pattern) => {
    expect(isAuthorityConfig({ ...authority, inline_allow: [pattern] })).toBe(false);
  });

  test("returns deterministic path-sorted decisions with complete coverage", () => {
    const subjects = [
      subject("prompts/z.md", "prompt", "yaml-frontmatter"),
      subject("src/a.ts", "source", "line-comment"),
      subject("asset.zip", "source", "skip-binary"),
      subject("vendor/b.js", "source", "line-comment"),
    ];
    const decisions = resolveCarrierDecisions({ authority, mode: "check", subjects });
    expect(decisions.map((item) => item.path)).toEqual(["asset.zip", "prompts/z.md", "src/a.ts", "vendor/b.js"]);
    assertCarrierDecisionCoverage(subjects, decisions);
  });

  test("rejects duplicate subjects and incomplete decision ledgers", () => {
    const duplicate = subject("src/a.ts", "source", "line-comment");
    expect(() => resolveCarrierDecisions({ authority, mode: "check", subjects: [duplicate, duplicate] })).toThrow(/duplicate/);
    expect(() => assertCarrierDecisionCoverage([duplicate], [])).toThrow(/coverage mismatch/);
  });

  test.each(["/x", "../x", "a\\b", ".", ""])("rejects unsafe subject path %s", (filePath) => {
    expect(() => resolveCarrierDecision(subject(filePath, "context", "yaml-frontmatter"), authority, "check")).toThrow();
  });
});
