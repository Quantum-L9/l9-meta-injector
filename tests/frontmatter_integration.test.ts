import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveStrategy } from "../src/comment";
import { injectFile } from "../src/inject";
import type { NormalizedMeta } from "../src/schema";

const META: NormalizedMeta = {
  id: "test.frontmatter",
  title: "Frontmatter test",
  artifact_type: "context",
  mcp_primitive: "resource",
  callable: false,
  retrievable: true,
  injectable: true,
  namespace: "test",
  sharing_scope: "private",
  source_path: "doc.md",
  content_hash: "0".repeat(64),
  token_cost_estimate: 1,
  authority: "test",
  created_or_detected_at: "Unknown",
  family: "Unknown",
  description: "test",
  activation_signals: ["test"],
  input_contract: "Unknown",
  output_contract: "Unknown",
  validation_gates: "Unknown",
  stop_conditions: "Unknown",
};

describe("frontmatter integration safety", () => {
  test("only plain Markdown is an inline YAML-frontmatter carrier", () => {
    expect(resolveStrategy("doc.md", "Body").strategy).toBe("yaml-frontmatter");
    expect(resolveStrategy("doc.markdown", "Body").strategy).toBe("yaml-frontmatter");
    expect(resolveStrategy("doc.mdx", "Body").strategy).toBe("sidecar");
    expect(resolveStrategy("doc.rst", "Body").strategy).toBe("sidecar");
    expect(resolveStrategy("doc.txt", "Body").strategy).toBe("sidecar");
  });

  test("unsafe existing YAML fails closed without changing the file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-frontmatter-"));
    const target = path.join(dir, "doc.md");
    const original = "---\nowner:\n  name: alice\n---\nBody\n";
    fs.writeFileSync(target, original, "utf8");
    expect(() => injectFile(target, META, {
      dryRun: false,
      outDir: dir,
      verbose: false,
      writeInjectLog: false,
      writeDryRunDiff: false,
    })).toThrow(/FRONTMATTER_UNSAFE/);
    expect(fs.readFileSync(target, "utf8")).toBe(original);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("skills mode source uses managed patching instead of whole-header serialization", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "skills_pipeline.ts"), "utf8");
    expect(source).toContain("patchManagedFrontMatter");
    expect(source).toContain("inspectFrontMatterDocument");
    expect(source).not.toContain("function writeFrontMatter");
    expect(source).not.toContain("serializeYamlObject");
  });
});
