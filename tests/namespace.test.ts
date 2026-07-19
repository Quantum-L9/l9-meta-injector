import { resolveNamespace, toSnakeStem } from "../src/namespace";

const base = { namespace: "l9", authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16, outputDir: ".out", indexDir: "." };

describe("resolveNamespace", () => {
  it("default namespace from config", () => expect(resolveNamespace("/repos/l9/skills/foo.md", base).namespace).toBe("l9"));
  it("skill primitive from skills/ path", () => expect(resolveNamespace("/repos/l9/skills/foo.md", base).primitiveFolder).toBe("skill"));
  it("playbook from playbooks/ path", () => expect(resolveNamespace("/repos/l9/playbooks/foo.md", base).primitiveFolder).toBe("playbook"));
  it("shared scope from _shared/ path", () => expect(resolveNamespace("/repos/_shared/kernels/foo.md", base).sharingScope).toBe("shared"));
  it("private scope from l9/ path", () => expect(resolveNamespace("/repos/l9/kernels/foo.md", base).sharingScope).toBe("private"));
  it("agnostic scope for unknown path", () => expect(resolveNamespace("/tmp/foo.md", base).sharingScope).toBe("agnostic"));
  it("namespaceGlob override", () => {
    const cfg = { ...base, namespaceGlobs: [{ glob: "plastos/**", namespace: "plastos" }] };
    expect(resolveNamespace("/repos/plastos/skills/foo.md", cfg).namespace).toBe("plastos");
  });
  it("dot-convention skill detection", () => expect(resolveNamespace("/path/l9.skill.lint_file.md", base).primitiveFolder).toBe("skill"));
  it("Prompt- prefix → prompt primitive", () => expect(resolveNamespace("/path/Prompt-AuditAgent.md", base).primitiveFolder).toBe("prompt"));
  it("idStem format is ns.primitive.stem", () => expect(resolveNamespace("/repos/l9/skills/lint_file.md", base).idStem).toMatch(/^l9\.skill\.[a-z0-9_]+$/));
});

describe("toSnakeStem", () => {
  it("camelCase → snake_case", () => expect(toSnakeStem("lintFile.md")).toBe("lint_file"));
  it("hyphens → underscores", () => expect(toSnakeStem("text-chunk.md")).toBe("text_chunk"));
  it("strips Prompt- prefix", () => expect(toSnakeStem("Prompt-AuditAgent.md")).toBe("audit_agent"));
  it("already snake — no change", () => expect(toSnakeStem("lint_file.md")).toBe("lint_file"));
  it("lowercases", () => expect(toSnakeStem("MySkill.md")).toBe("my_skill"));
});
