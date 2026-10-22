import { resolveNamespace, toSnakeStem } from "../src/namespace";

const base = { namespace: "l9", authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16, outputDir: ".out", indexDir: "." };

describe("resolveNamespace", () => {
  it("default namespace from config", () => expect(resolveNamespace("/repos/l9/skills/foo.md", base).namespace).toBe("l9"));
  it("skill primitive from skills/ path", () => expect(resolveNamespace("/repos/l9/skills/foo.md", base).primitiveFolder).toBe("skill"));
  it("playbook from playbooks/ path", () => expect(resolveNamespace("/repos/l9/playbooks/foo.md", base).primitiveFolder).toBe("playbook"));
  it("shared scope from _shared/ path", () => expect(resolveNamespace("/repos/_shared/kernels/foo.md", base).sharingScope).toBe("shared"));
  it("private scope from l9/ path", () => expect(resolveNamespace("/repos/l9/kernels/foo.md", base).sharingScope).toBe("private"));
  it("agnostic scope for unknown path", () => expect(resolveNamespace("/tmp/foo.md", base).sharingScope).toBe("agnostic"));
  // A "core"/"shared"/"common" folder segment in a non-prose file is a code-organization
  // detail (e.g. a tool's own `core/` module), not a namespace-sharing convention — applying
  // the shared/private signal there produced a false sharing_scope=shared for legacy Python
  // files under tools/consolidation/core/**, which verify.ts's checkSharingScope then flagged
  // as a spurious violation against the run's namespace. Regression guard for that drift.
  it("code files under a core/ or shared/ folder stay agnostic (not a namespace-sharing signal)", () => {
    expect(resolveNamespace("/repo/tools/consolidation/core/__init__.py", base).sharingScope).toBe("agnostic");
    expect(resolveNamespace("/repo/shared/utils.ts", base).sharingScope).toBe("agnostic");
  });
  it("namespaceGlob override", () => {
    const cfg = { ...base, namespaceGlobs: [{ glob: "plastos/**", namespace: "plastos" }] };
    expect(resolveNamespace("/repos/plastos/skills/foo.md", cfg).namespace).toBe("plastos");
  });
  it("dot-convention skill detection", () => expect(resolveNamespace("/path/l9.skill.lint_file.md", base).primitiveFolder).toBe("skill"));
  it("Prompt- prefix → prompt primitive", () => expect(resolveNamespace("/path/Prompt-AuditAgent.md", base).primitiveFolder).toBe("prompt"));
  it("idStem format is ns.primitive.stem", () => expect(resolveNamespace("/repos/l9/skills/lint_file.md", base).idStem).toMatch(/^l9\.skill\.[a-z0-9_]+$/));
  it("a top-level skills folder is a skill primitive", () => {
    expect(resolveNamespace("skills/lint_file.md", base).primitiveFolder).toBe("skill");
  });
  it("keeps the extension so files that differ only by extension stay distinct", () => {
    expect(resolveNamespace("config.ts", base, "source").idStem).toBe("l9.source.config__ts");
    expect(resolveNamespace("config.json", base, "source").idStem).toBe("l9.source.config__json");
    expect(resolveNamespace("notes.md", base, "context").idStem).toBe("l9.context.notes__md");
    expect(resolveNamespace("notes.txt", base, "context").idStem).toBe("l9.context.notes__txt");
  });
  it("still collapses hyphen and underscore into one stem", () => {
    expect(resolveNamespace("a-b.md", base).idStem).toBe(resolveNamespace("a_b.md", base).idStem);
  });
  it("nested index files stay unique and an absolute path uses the basename", () => {
    expect(resolveNamespace("src/index.ts", base, "source").idStem).toBe("l9.source.src_index__ts");
    expect(resolveNamespace("lib/index.ts", base, "source").idStem).toBe("l9.source.lib_index__ts");
    expect(resolveNamespace("/repos/l9/src/index.ts", base, "source").idStem).toBe("l9.source.index__ts");
  });
  it("a stem does not change when the call is repeated", () => {
    expect(resolveNamespace("src/app.ts", base).idStem).toBe(resolveNamespace("src/app.ts", base).idStem);
  });
});

describe("toSnakeStem", () => {
  it("camelCase → snake_case", () => expect(toSnakeStem("lintFile.md")).toBe("lint_file"));
  it("hyphens → underscores", () => expect(toSnakeStem("text-chunk.md")).toBe("text_chunk"));
  it("strips Prompt- prefix", () => expect(toSnakeStem("Prompt-AuditAgent.md")).toBe("audit_agent"));
  it("already snake — no change", () => expect(toSnakeStem("lint_file.md")).toBe("lint_file"));
  it("lowercases", () => expect(toSnakeStem("MySkill.md")).toBe("my_skill"));
});
