import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { inventoryTree, classifyInventory, buildRecord } from "../src/inventory";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "l9-inv-")); }
function tree(root: string) {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const x = 1;\n");
  fs.writeFileSync(path.join(root, "docs", "guide.md"), "# Guide\ntext\n");
  fs.writeFileSync(path.join(root, "config.json"), "{\"a\":1}\n");
  fs.writeFileSync(path.join(root, "l9_meta.schema.json"), "{\"type\":\"object\"}\n");
  fs.writeFileSync(path.join(root, "Prompt-Legal.md"), "## Role\nAnalyst\n");
  fs.writeFileSync(path.join(root, "paper.pdf"), "%PDF-1.4 fake pdf text\n");
  fs.writeFileSync(path.join(root, "bundle.zip"), "PK fake zip\n");
  fs.writeFileSync(path.join(root, "blob.bin"), Buffer.from([0, 1, 2, 0, 3]));
}

describe("classifyInventory — ArtifactInventory taxonomy", () => {
  const C = (p: string, isDir = false) => classifyInventory(p, path.basename(p), path.extname(p), isDir).type;
  it("folder", () => expect(C("some/dir", true)).toBe("folder"));
  it("code", () => expect(C("src/app.ts")).toBe("code"));
  it("schema", () => expect(C("x.schema.json")).toBe("schema"));
  it("prompt by name", () => expect(C("Prompt-Legal.md")).toBe("prompt"));
  it("prompt by path", () => expect(C("prompts/legal.md")).toBe("prompt"));
  it("test", () => expect(C("foo.test.ts")).toBe("test"));
  it("research_pdf", () => expect(C("paper.pdf")).toBe("research_pdf"));
  it("archive", () => expect(C("bundle.zip")).toBe("archive"));
  it("config", () => expect(C("config.json")).toBe("config"));
  it("documentation", () => expect(C("docs/guide.md")).toBe("documentation"));
  it("unknown for unrecognized", () => expect(C("data.csv")).toBe("unknown"));
});

describe("inventoryTree — non-destructive filesystem inventory", () => {
  it("dry-run classifies everything and writes manifest WITHOUT touching source", () => {
    const root = tmp(); tree(root);
    const before = fs.readFileSync(path.join(root, "docs", "guide.md"), "utf8");
    const out = tmp();
    const r = inventoryTree({ root, outDir: out, dryRun: true, now: "2026-01-01T00:00:00.000Z" });

    expect(r.folders).toBe(2);         // src, docs
    expect(r.files).toBe(8);
    expect(r.total).toBe(10);
    expect(fs.existsSync(path.join(out, "inventory.json"))).toBe(true);
    expect(fs.existsSync(path.join(out, "inventory.csv"))).toBe(true);
    expect(fs.existsSync(path.join(out, "inventory.md"))).toBe(true);
    // source untouched in dry-run
    expect(fs.readFileSync(path.join(root, "docs", "guide.md"), "utf8")).toBe(before);
    expect(fs.existsSync(path.join(root, "docs", ".l9meta.yaml"))).toBe(false);
    // record shape matches the ArtifactInventory schema essentials
    const rec = r.records.find((x) => x.file_name === "app.ts")!;
    expect(rec.artifact_type).toBe("code");
    expect(rec.relative_path).toBe("src/app.ts");
    expect(rec.parent_folder).toBe("src");
    expect(rec.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Array.isArray(rec.unknowns)).toBe(true);
  });

  it("live run: headers into text, sidecars for binaries, folder sidecars; no rename/delete", () => {
    const root = tmp(); tree(root);
    const namesBefore = fs.readdirSync(root).sort();
    const out = tmp();
    const r = inventoryTree({ root, outDir: out, dryRun: false, now: "2026-01-01T00:00:00.000Z" });
    expect(r.total).toBe(10);

    // header appended to markdown/code (frontmatter/comment)
    expect(fs.readFileSync(path.join(root, "docs", "guide.md"), "utf8").startsWith("---")).toBe(true);
    expect(fs.readFileSync(path.join(root, "src", "app.ts"), "utf8")).toContain("// >>> l9:meta >>>");
    // body preserved
    expect(fs.readFileSync(path.join(root, "src", "app.ts"), "utf8").trimEnd().endsWith("export const x = 1;")).toBe(true);
    // binary + pdf get sidecars, not header injection
    expect(fs.existsSync(path.join(root, "blob.bin.l9meta.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(root, "paper.pdf.l9meta.yaml"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "blob.bin"))).toEqual(Buffer.from([0, 1, 2, 0, 3])); // untouched bytes
    // folder metadata sidecars
    expect(fs.existsSync(path.join(root, "src", ".l9meta.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(root, "docs", ".l9meta.yaml"))).toBe(true);
    // NON-DESTRUCTIVE: every original entry still present (nothing renamed/deleted)
    for (const n of namesBefore) expect(fs.existsSync(path.join(root, n))).toBe(true);
  });

  it("buildRecord fills required ArtifactInventory fields", () => {
    const root = tmp(); tree(root);
    const rec = buildRecord(root, path.join(root, "l9_meta.schema.json"), false, { sourceSystem: "dropbox", hashMaxBytes: 1e9, now: "2026-01-01T00:00:00.000Z" });
    expect(rec.artifact_id).toMatch(/^inv-[a-f0-9]{16}$/);
    expect(rec.source_system).toBe("dropbox");
    expect(rec.artifact_type).toBe("schema");
    expect(rec.classification_confidence).toBeGreaterThan(0);
    expect(rec.unknowns).toEqual([]);
  });
});
