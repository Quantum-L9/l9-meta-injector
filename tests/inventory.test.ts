import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { inventoryTree, classifyInventory, buildRecord } from "../src/inventory";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "l9-inv-")); }

describe("inventory Copilot fixes (PR #5)", () => {
  it("byte-based content_hash: two distinct binaries do NOT collapse into one hash", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.bin"), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    fs.writeFileSync(path.join(root, "b.bin"), Buffer.from([0xff, 0xfe, 0x00, 0x02]));
    const out = tmp();
    const r = inventoryTree({ root, outDir: out, dryRun: true, now: "2026-01-01T00:00:00.000Z" });
    const a = r.records.find((x) => x.file_name === "a.bin")!;
    const b = r.records.find((x) => x.file_name === "b.bin")!;
    expect(a.content_hash).not.toBe(b.content_hash); // utf8 decode would have collapsed these
    expect(r.duplicates).toHaveLength(0);
  });
  it("default ignore excludes the .l9inventory output dir (no self-inventory on re-run)", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "x.md"), "# x\n");
    fs.mkdirSync(path.join(root, ".l9inventory"));
    fs.writeFileSync(path.join(root, ".l9inventory", "inventory.json"), "{}");
    const out = path.join(root, ".l9inventory");
    const r = inventoryTree({ root, outDir: out, dryRun: true, now: "2026-01-01T00:00:00.000Z" });
    expect(r.records.some((x) => x.relative_path.startsWith(".l9inventory"))).toBe(false);
  });
  it("relative root is absolutized → absolute_path is absolute", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "y.ts"), "const y=1;\n");
    const rel = path.relative(process.cwd(), root);
    const out = tmp();
    const r = inventoryTree({ root: rel, outDir: out, dryRun: true, now: "2026-01-01T00:00:00.000Z" });
    expect(r.records.every((x) => x.absolute_path === null || path.isAbsolute(x.absolute_path))).toBe(true);
  });
});

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
  it("CODEOWNERS config", () => expect(C("CODEOWNERS")).toBe("config"));
  it("LICENSE documentation", () => expect(C("LICENSE")).toBe("documentation"));
  it("ql code", () => expect(C("rules.ql")).toBe("code"));

  // A well-known filename outranks whatever its extension would default to.
  it("Dockerfile config", () => expect(C("Dockerfile")).toBe("config"));
  it("Dockerfile.prod config", () => expect(C("Dockerfile.prod")).toBe("config"));
  it("nested Dockerfile config", () => expect(C("chassis/Dockerfile.chassis")).toBe("config"));
  it("Makefile config", () => expect(C("Makefile")).toBe("config"));
  it("requirements.txt is a manifest, not a .txt document", () =>
    expect(C("requirements.txt")).toBe("config"));
  it("requirements-dev.txt config", () => expect(C("requirements-dev.txt")).toBe("config"));
  it(".env.example config", () => expect(C(".env.example")).toBe("config"));
  it(".env.required config", () => expect(C(".env.required")).toBe("config"));

  // Names that merely start with the same letters must not be captured.
  it("dockerfiles.md stays documentation", () => expect(C("docs/dockerfiles.md")).toBe("documentation"));
  it("requirements.md stays documentation", () => expect(C("requirements.md")).toBe("documentation"));
  it("environment.txt stays documentation", () => expect(C("environment.txt")).toBe("documentation"));

  // Structural signals still outrank the filename table.
  it("a Dockerfile under tests/ is still a test", () =>
    expect(C("tests/Dockerfile")).toBe("test"));
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

  it("live run: headers into text, sidecars for comment-less text, skip-binary untouched; folder sidecars; no rename/delete", () => {
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
    // JSON (sidecar strategy) gets a sidecar; recognized archives get an adjacent
    // sidecar without rewriting archive bytes; other binaries/pdf stay skip-binary.
    expect(fs.existsSync(path.join(root, "config.json.l9meta.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(root, "bundle.zip.l9meta.yaml"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "bundle.zip"))).toEqual(Buffer.from("PK fake zip\n"));
    expect(fs.existsSync(path.join(root, "blob.bin.l9meta.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(root, "paper.pdf.l9meta.yaml"))).toBe(false);
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
    expect(rec.unknowns).toContain("clock_skew:modified_at_after_inspected_at");
    if (rec.created_at) expect(rec.unknowns).toContain("clock_skew:created_at_after_inspected_at");
  });

  it("buildRecord decides clock skew on instants, not on ISO string order", () => {
    const root = tmp(); tree(root);
    const file = path.join(root, "l9_meta.schema.json");
    const modified = new Date("2026-10-04T00:30:00.000Z");
    fs.utimesSync(file, modified, modified);
    // 01:00+02:00 is 23:00Z the previous day: earlier than the modification,
    // although the string "2026-10-04T00:30:00.000Z" sorts before it.
    const offset = buildRecord(root, file, false, { sourceSystem: "dropbox", hashMaxBytes: 1e9, now: "2026-10-04T01:00:00+02:00" });
    expect(offset.unknowns).toContain("clock_skew:modified_at_after_inspected_at");
    // The same instant written in UTC later than the modification: no skew.
    const later = buildRecord(root, file, false, { sourceSystem: "dropbox", hashMaxBytes: 1e9, now: "2026-10-04T00:30:00.001Z" });
    expect(later.unknowns).not.toContain("clock_skew:modified_at_after_inspected_at");
  });
});

describe("WU-078 nested outDir is excluded by its exact path", () => {
  const NOW = "2026-01-01T00:00:00.000Z";

  it("REG-WU-078-RC-055-RC055-a: same-named directories elsewhere are still inventoried", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "docs", "guide"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "guide", "intro.txt"), "intro\n");
    fs.mkdirSync(path.join(root, "lib", "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "lib", "docs", "api.txt"), "api\n");
    const out = path.join(root, "docs", ".l9out");
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "inventory.json"), "{}");
    const r = inventoryTree({ root, outDir: out, dryRun: true, now: NOW });
    const rels = r.records.map((x) => x.relative_path);
    expect(rels).toContain("docs/guide/intro.txt");
    expect(rels).toContain("lib/docs/api.txt");
    expect(rels.some((p) => p.startsWith("docs/.l9out"))).toBe(false);
    expect(r.omittedPaths).toContain("docs/.l9out");
    expect(r.omittedPaths).not.toContain("docs");
    expect(r.omittedPaths).not.toContain("lib/docs");
  });

  it("REG-WU-078-RC-055-RC055-b: a nested outDir's generated output is never re-inventoried or annotated", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "x.md"), "# x\n");
    const out = path.join(root, "out");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "inventory.json"), "{}");
    for (let run = 0; run < 2; run++) {
      const r = inventoryTree({ root, outDir: out, dryRun: false, folderSidecars: true, now: NOW });
      expect(r.records.some((x) => x.relative_path === "out" || x.relative_path.startsWith("out/"))).toBe(false);
    }
    expect(fs.readdirSync(out).some((name) => name.endsWith(".l9meta.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(root, "out.l9meta.yaml"))).toBe(false);
  });

  it("REG-WU-078-RC-055-RC055-c: the default .l9inventory out dir stays excluded", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "x.md"), "# x\n");
    fs.mkdirSync(path.join(root, ".l9inventory"));
    fs.writeFileSync(path.join(root, ".l9inventory", "inventory.json"), "{}");
    const r = inventoryTree({ root, outDir: path.join(root, ".l9inventory"), dryRun: true, now: NOW });
    expect(r.records.some((x) => x.relative_path.startsWith(".l9inventory"))).toBe(false);
    expect(r.records.some((x) => x.relative_path === "x.md")).toBe(true);
  });

  it("REG-WU-078-RC-055-RC055-d: glob metacharacters in the outDir path exclude only that directory", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "a1"));
    fs.writeFileSync(path.join(root, "a1", "file.txt"), "a1\n");
    fs.mkdirSync(path.join(root, "a[1]", "out"), { recursive: true });
    fs.writeFileSync(path.join(root, "a[1]", "keep.txt"), "keep\n");
    fs.writeFileSync(path.join(root, "a[1]", "out", "inventory.json"), "{}");
    const r = inventoryTree({ root, outDir: path.join(root, "a[1]", "out"), dryRun: true, now: NOW });
    const rels = r.records.map((x) => x.relative_path);
    expect(rels).toContain("a1/file.txt");
    expect(rels).toContain("a[1]/keep.txt");
    expect(rels.some((p) => p.startsWith("a[1]/out"))).toBe(false);
    expect(r.omittedPaths).toContain("a[1]/out");
  });
});
