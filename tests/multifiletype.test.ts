import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runPipelineAsync } from "../src/pipeline";
import { PipelineConfig } from "../src/schema";
import { findFiles } from "../src/retrieval";
import { resolveStrategy, sidecarPathFor, yamlToBlock, applyCommentInjection, stripInjectedBlock, hasInjectedBlock } from "../src/comment";

describe("CRLF handling (Copilot PR#3): injected block strip/detect on Windows line endings", () => {
  it("line-comment: strip restores a CRLF body exactly and detects the block", () => {
    const spec = resolveStrategy("app.ts", "");
    const block = yamlToBlock("id: 1\ntype: code", spec);
    const body = "export const x = 1;\r\nconst y = 2;\r\n";
    const injected = applyCommentInjection(body, block);
    expect(hasInjectedBlock(injected, spec)).toBe(true);
    expect(stripInjectedBlock(injected, spec)).toBe(body); // no orphaned \r, no drift
  });
  it("block-comment: same on CRLF", () => {
    const spec = resolveStrategy("page.html", "");
    const block = yamlToBlock("id: 1", spec);
    const body = "<div>\r\n</div>\r\n";
    const injected = applyCommentInjection(body, block);
    expect(hasInjectedBlock(injected, spec)).toBe(true);
    expect(stripInjectedBlock(injected, spec)).toBe(body);
  });
});

describe("findFiles binary exclusion under extension filter (Copilot PR#3)", () => {
  it("**/*.png filter excludes binary-extension files (never read as UTF-8)", () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]));
    fs.writeFileSync(path.join(root, "b.png"), Buffer.from([0, 1, 2]));
    const found = findFiles(root, "**/*.png");
    expect(found).toHaveLength(0);
  });
});

function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), "l9-mft-")); return d; }
function cfg(root: string, out: string): PipelineConfig {
  return {
    root, glob: "**/*", dryRun: false, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
  };
}

describe("resolveStrategy — per-extension routing", () => {
  const cases: Array<[string, string]> = [
    ["a.ts", "line-comment"], ["a.tsx", "line-comment"], ["a.py", "line-comment"],
    ["a.go", "line-comment"], ["a.rs", "line-comment"], ["a.yaml", "line-comment"],
    ["a.sql", "line-comment"], ["a.css", "block-comment"], ["a.scss", "block-comment"],
    ["a.html", "block-comment"], ["a.svg", "block-comment"], ["a.vue", "block-comment"],
    ["a.md", "yaml-frontmatter"], ["a.txt", "sidecar"], ["a.json", "sidecar"],
    ["a.csv", "sidecar"], ["a.png", "skip-binary"], ["a.mp4", "skip-binary"], ["a.zip", "skip-binary"],
    ["Dockerfile", "line-comment"], ["Makefile", "line-comment"], [".gitignore", "line-comment"],
    ["CODEOWNERS", "line-comment"], ["a.ql", "line-comment"], ["a.qls", "line-comment"],
    ["a.pyc", "skip-binary"], ["a.log", "skip-binary"],
  ];
  for (const [file, strat] of cases) {
    it(`${file} → ${strat}`, () => expect(resolveStrategy(file, "").strategy).toBe(strat));
  }
  it("null-byte content → skip-binary regardless of extension", () => {
    expect(resolveStrategy("a.ts", "abc\0def").strategy).toBe("skip-binary");
  });
});

describe("multi-filetype injection", () => {
  const files: Record<string, string> = {
    "app.ts": "export const x = 1;\n",
    "script.py": "print('hi')\n",
    "run.sh": "#!/usr/bin/env bash\necho hi\n",
    "style.css": "body { color: red; }\n",
    "page.html": "<!doctype html>\n<html></html>\n",
    "config.yaml": "key: value\n",
    "data.json": "{\n  \"a\": 1\n}\n",
  };

  it("injects valid, filetype-appropriate headers and preserves bodies", async () => {
    const root = tmpDir(); const out = tmpDir();
    for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(root, n), c);
    const result = await runPipelineAsync(cfg(root, out));

    // every injected/verified file is clean
    expect(result.verified.length).toBeGreaterThanOrEqual(6);
    expect(result.verified.every((v) => v.yamlValid && v.bodyPreserved && v.taxonomyValid)).toBe(true);

    const ts = fs.readFileSync(path.join(root, "app.ts"), "utf8");
    expect(ts).toContain("// >>> l9:meta >>>");
    expect(ts).toContain("// artifact_type: source");
    expect(ts).toContain("// <<< l9:meta <<<");
    expect(ts.trimEnd().endsWith("export const x = 1;")).toBe(true);

    const py = fs.readFileSync(path.join(root, "script.py"), "utf8");
    expect(py).toContain("# >>> l9:meta >>>");
    expect(py).toContain("print('hi')");

    // shebang must stay on line 1
    const sh = fs.readFileSync(path.join(root, "run.sh"), "utf8");
    expect(sh).toBe(files["run.sh"]);
    expect(sh).not.toContain("l9:meta");

    const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
    expect(css).toContain("/* l9:meta:start");
    expect(css).toContain("l9:meta:end */");
    expect(css).toContain("body { color: red; }");

    const html = fs.readFileSync(path.join(root, "page.html"), "utf8");
    expect(html).toContain("<!-- l9:meta:start");
    expect(html).toContain("l9:meta:end -->");
    expect(html).toContain("<!doctype html>");

    const yaml = fs.readFileSync(path.join(root, "config.yaml"), "utf8");
    expect(yaml).toContain("# >>> l9:meta >>>");
    expect(yaml).toContain("key: value");

    // JSON: file untouched (still parses), metadata in sidecar
    const jsonRaw = fs.readFileSync(path.join(root, "data.json"), "utf8");
    expect(jsonRaw).toBe(files["data.json"]);
    expect(() => JSON.parse(jsonRaw)).not.toThrow();
    const sidecar = sidecarPathFor(path.join(root, "data.json"));
    expect(fs.existsSync(sidecar)).toBe(true);
    expect(fs.readFileSync(sidecar, "utf8")).toContain("artifact_type: source");
  });

  it("is idempotent — re-injection replaces the block, no duplication", async () => {
    const root = tmpDir(); const out = tmpDir();
    fs.writeFileSync(path.join(root, "app.ts"), files["app.ts"]);
    await runPipelineAsync(cfg(root, out));
    const once = fs.readFileSync(path.join(root, "app.ts"), "utf8");
    await runPipelineAsync(cfg(root, out));
    const twice = fs.readFileSync(path.join(root, "app.ts"), "utf8");

    const count = (s: string) => (s.match(/>>> l9:meta >>>/g) || []).length;
    expect(count(once)).toBe(1);
    expect(count(twice)).toBe(1);
    expect(twice).toBe(once); // byte-for-byte stable
    expect(twice.trimEnd().endsWith("export const x = 1;")).toBe(true);
  });
});

describe("findFiles — binary/media exclusion", () => {
  it("excludes known-binary extensions and null-byte files under a wildcard glob", () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "keep.ts"), "const a = 1;\n");
    fs.writeFileSync(path.join(root, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]));
    fs.writeFileSync(path.join(root, "noext_binary"), Buffer.from([65, 0, 66, 67]));
    const found = findFiles(root, "**/*").map((f) => path.basename(f));
    expect(found).toContain("keep.ts");
    expect(found).not.toContain("img.png");
    expect(found).not.toContain("noext_binary");
  });
});
