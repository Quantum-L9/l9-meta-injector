// inventory_convergence.test.ts — live inventory annotation reaches a fixed point
// (ADR-060, RC-050) and never overwrites a hand-authored file sidecar it cannot
// reproduce byte for byte (RC-051).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { inventoryTree, type InventoryResult } from "../src/inventory";
import { contentHash } from "../src/extract";
import { toMetaSchema } from "../src/meta_schema";
import { buildZipBuffer, peekZipRootMeta } from "../src/zip_writer";

const roots: string[] = [];
function tmp(prefix = "l9-inv-conv-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const NOW = "2030-01-01T00:00:00.000Z";

function run(root: string, now = NOW, extra: Record<string, unknown> = {}): InventoryResult {
  return inventoryTree({ root, outDir: path.join(tmp("l9-inv-conv-out-"), "out"), now, ...extra });
}

interface Observed { bytes: string; ino: number; mtimeMs: number }
function observe(root: string, rels: string[]): Record<string, Observed> {
  const out: Record<string, Observed> = {};
  for (const rel of rels) {
    const abs = path.join(root, rel);
    const st = fs.statSync(abs);
    out[rel] = { bytes: fs.readFileSync(abs, "utf8"), ino: st.ino, mtimeMs: st.mtimeMs };
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Field → value of a line-comment managed block. */
function commentHeader(text: string): Array<[string, string]> {
  const start = text.indexOf("// >>> l9:meta >>>");
  const end = text.indexOf("// <<< l9:meta <<<");
  expect(start).toBeGreaterThanOrEqual(0);
  return text.slice(start, end).split("\n").slice(1)
    .filter((line) => line.startsWith("// "))
    .map((line) => {
      const body = line.slice(3);
      const colon = body.indexOf(":");
      return [body.slice(0, colon), body.slice(colon + 1).trim().replace(/^"|"$/g, "")] as [string, string];
    });
}

function field(text: string, key: string): string | undefined {
  const match = new RegExp(`^(?://\\s)?${key}:\\s*"?([^"\\n]*)"?$`, "m").exec(text);
  return match?.[1];
}

describe("WU-074 RC-050: annotation converges for identical inputs", () => {
  test("REG-WU-074-RC-050-RC050-a: runs 2 and 3 with the same now leave every carrier byte-, inode- and mtime-identical", async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "sub"));
    fs.writeFileSync(path.join(root, "a.md"), "# A\n\nBody.\n");
    fs.writeFileSync(path.join(root, "b.ts"), "export const b = 1;\n");
    fs.writeFileSync(path.join(root, "c.json"), "{\"c\":1}\n");
    fs.writeFileSync(path.join(root, "sub", "d.py"), "print('d')\n");
    fs.writeFileSync(path.join(root, "sub", "e.json"), "{\"e\":2}\n");
    const carriers = ["a.md", "b.ts", "c.json.l9meta.yaml", "sub/.l9meta.yaml", "sub/d.py", "sub/e.json.l9meta.yaml"];
    run(root);
    const first = observe(root, carriers);
    await sleep(1100);
    run(root);
    const second = observe(root, carriers);
    await sleep(1100);
    run(root);
    const third = observe(root, carriers);
    for (const rel of carriers) {
      expect(second[rel], `${rel} after run 2`).toEqual(first[rel]);
      expect(third[rel], `${rel} after run 3`).toEqual(first[rel]);
    }
  }, 20_000);

  test("REG-WU-074-RC-050-RC050-a (--schema): a schema that maps content_hash converges the same way", async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "sub"));
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    fs.writeFileSync(path.join(root, "b.ts"), "export const b = 1;\n");
    fs.writeFileSync(path.join(root, "c.json"), "{\"c\":1}\n");
    const schema = toMetaSchema({
      schema_id: "convergence",
      fields: [
        { name: "id", source: "artifact_id" },
        { name: "modified_at", source: "modified_at" },
        { name: "kind", source: "artifact_type" },
        { name: "hash", source: "content_hash" },
      ],
    });
    const carriers = ["a.md", "b.ts", "c.json.l9meta.yaml", "sub/.l9meta.yaml"];
    run(root, NOW, { schema });
    const first = observe(root, carriers);
    await sleep(50);
    run(root, NOW, { schema });
    const second = observe(root, carriers);
    for (const rel of carriers) expect(second[rel], rel).toEqual(first[rel]);
  });

  test("REG-WU-074-RC-050-RC050-b: a body edit changes content_hash and moves header modified_at to the edit's mtime", async () => {
    const root = tmp();
    const file = path.join(root, "b.ts");
    fs.writeFileSync(file, "export const b = 1;\n");
    run(root);
    const before = fs.readFileSync(file, "utf8");
    await sleep(20);
    const edited = before.replace("export const b = 1;", "export const b = 2;");
    fs.writeFileSync(file, edited);
    const editMtime = fs.lstatSync(file).mtime.toISOString();
    const result = run(root);
    const after = fs.readFileSync(file, "utf8");
    const rec = result.records.find((r) => r.relative_path === "b.ts")!;
    expect(rec.content_hash).toBe(contentHash("export const b = 2;\n"));
    expect(field(after, "content_hash")).toBe(rec.content_hash);
    expect(field(after, "content_hash")).not.toBe(field(before, "content_hash"));
    expect(field(after, "modified_at")).toBe(editMtime);
    // AC-WU-074-RC-050-02: the record keeps the lstat observation.
    expect(rec.modified_at).toBe(editMtime);
  });

  test("REG-WU-074-RC-050-RC050-c: a later now updates inspected_at and keeps modified_at and created_at", async () => {
    const root = tmp();
    const file = path.join(root, "b.ts");
    fs.writeFileSync(file, "export const b = 1;\n");
    run(root, "2030-01-01T00:00:00.000Z");
    const first = fs.readFileSync(file, "utf8");
    await sleep(20);
    const second = run(root, "2030-06-01T00:00:00.000Z");
    const after = fs.readFileSync(file, "utf8");
    expect(field(after, "inspected_at")).toBe("2030-06-01T00:00:00.000Z");
    expect(field(after, "modified_at")).toBe(field(first, "modified_at"));
    expect(field(after, "created_at")).toBe(field(first, "created_at"));
    // The record stays an observation (ADR-051 item 6): run 1's own write moved
    // the file's mtime, and the record says so while the carrier does not.
    const rec = second.records.find((r) => r.relative_path === "b.ts")!;
    expect(rec.modified_at).not.toBe(field(after, "modified_at"));
  });

  test("REG-WU-074-RC-050-RC050-d: an unparseable harvested clock or a stale content_hash is not carried", () => {
    const root = tmp();
    const body = "export const b = 1;\n";
    const garbled = path.join(root, "garbled.ts");
    fs.writeFileSync(garbled, [
      "// >>> l9:meta >>>",
      `// content_hash: ${contentHash(body)}`,
      "// created_at: not-a-date",
      "// modified_at: yesterday",
      "// <<< l9:meta <<<",
      body,
    ].join("\n"));
    const stale = path.join(root, "stale.ts");
    fs.writeFileSync(stale, [
      "// >>> l9:meta >>>",
      `// content_hash: ${contentHash("something else\n")}`,
      "// created_at: \"2001-01-01T00:00:00.000Z\"",
      "// modified_at: \"2001-01-01T00:00:00.000Z\"",
      "// <<< l9:meta <<<",
      body,
    ].join("\n"));
    const result = run(root);
    for (const name of ["garbled.ts", "stale.ts"]) {
      const rec = result.records.find((r) => r.relative_path === name)!;
      const text = fs.readFileSync(path.join(root, name), "utf8");
      expect(field(text, "modified_at"), name).toBe(rec.modified_at);
      expect(field(text, "created_at"), name).toBe(rec.created_at ?? "Unknown");
      expect(text).not.toContain("2001-01-01");
      expect(text).not.toContain("yesterday");
    }
  });

  test("REG-WU-074-RC-050-RC050-e: a future mtime still yields clock_skew and the header carries the observed value", () => {
    const root = tmp();
    const file = path.join(root, "note.md");
    fs.writeFileSync(file, "# hi\n");
    const inspected = new Date().toISOString();
    const future = new Date(Date.now() + 120_000);
    fs.utimesSync(file, future, future);
    const result = run(root, inspected, { folderSidecars: false });
    const rec = result.records.find((row) => row.file_name === "note.md")!;
    expect(rec.unknowns).toContain("clock_skew:modified_at_after_inspected_at");
    expect(field(fs.readFileSync(file, "utf8"), "modified_at")).toBe(rec.modified_at);
  });

  test("REG-WU-074-RC-050-RC050-f: header key order does not depend on whether a harvest exists", () => {
    const fresh = tmp();
    fs.writeFileSync(path.join(fresh, "b.ts"), "export const b = 1;\n");
    run(fresh, "2030-01-01T00:00:00.000Z");
    const freshKeys = commentHeader(fs.readFileSync(path.join(fresh, "b.ts"), "utf8")).map(([k]) => k);

    const rerun = tmp();
    fs.writeFileSync(path.join(rerun, "b.ts"), "export const b = 1;\n");
    run(rerun, "2030-01-01T00:00:00.000Z");
    // A later now forces a rewrite whose input includes the harvested header.
    run(rerun, "2030-06-01T00:00:00.000Z");
    const rerunKeys = commentHeader(fs.readFileSync(path.join(rerun, "b.ts"), "utf8")).map(([k]) => k);

    expect(rerunKeys).toEqual(freshKeys);
    expect(freshKeys.indexOf("title")).toBe(freshKeys.indexOf("id") + 1);
    expect(freshKeys.indexOf("content_hash")).toBeLessThan(freshKeys.indexOf("inventory_type"));
  });

  test("REG-WU-074-RC-050-RC050-h: archive member annotation stays idempotent for the same now", () => {
    const root = tmp();
    const zipPath = path.join(root, "pack.zip");
    fs.writeFileSync(zipPath, buildZipBuffer([{ name: "readme.txt", data: Buffer.from("hello\n") }]));
    run(root, NOW, { folderSidecars: false });
    run(root, NOW, { folderSidecars: false });
    const second = fs.readFileSync(zipPath);
    run(root, NOW, { folderSidecars: false });
    expect(fs.readFileSync(zipPath)).toEqual(second);
    expect(peekZipRootMeta(zipPath)).toContain(NOW);
  });
});

describe("WU-074 RC-051: hand-authored file sidecars are never overwritten", () => {
  test("REG-WU-074-RC-051-RC051-a: an unparseable sidecar (comment + nested map) is left byte-identical and diagnosed", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "data.json"), "{\"a\":1}\n");
    const sidecar = path.join(root, "data.json.l9meta.yaml");
    const authored = "# my notes\nprimary:\n  nested:\n    deeper: value\n";
    fs.writeFileSync(sidecar, authored);
    const result = run(root);
    expect(fs.readFileSync(sidecar, "utf8")).toBe(authored);
    const rec = result.records.find((r) => r.relative_path === "data.json")!;
    expect(rec.unknowns).toContain("sidecar_unreadable");
  });

  test("REG-WU-074-RC-051-RC051-b: a parseable sidecar with a leading comment is left byte-identical and diagnosed as lossy", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "data.json"), "{\"a\":1}\n");
    const sidecar = path.join(root, "data.json.l9meta.yaml");
    const authored = "# operator notes, keep me\ntitle: Data\n";
    fs.writeFileSync(sidecar, authored);
    const result = run(root);
    expect(fs.readFileSync(sidecar, "utf8")).toBe(authored);
    const rec = result.records.find((r) => r.relative_path === "data.json")!;
    expect(rec.unknowns).toContain("sidecar_lossy_roundtrip");
  });

  test("REG-WU-074-RC-051-RC051-c: a tool-written sidecar is rewritten with current fields and the operator title survives", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "cfg.json"), "{\"a\":1}\n");
    const sidecar = path.join(root, "cfg.json.l9meta.yaml");
    fs.writeFileSync(sidecar, "---\ntitle: OperatorTitle\ntags:\n  - harvested\n---\n");
    run(root, "2030-01-01T00:00:00.000Z");
    const first = fs.readFileSync(sidecar, "utf8");
    expect(first).toContain("title: OperatorTitle");
    expect(first).toContain("inspected_at: \"2030-01-01T00:00:00.000Z\"");
    const second = run(root, "2030-06-01T00:00:00.000Z");
    const after = fs.readFileSync(sidecar, "utf8");
    expect(after).toContain("title: OperatorTitle");
    expect(after).toContain("inspected_at: \"2030-06-01T00:00:00.000Z\"");
    const rec = second.records.find((r) => r.relative_path === "cfg.json")!;
    expect(rec.unknowns.filter((u) => u.startsWith("sidecar_"))).toEqual([]);
  });

  test("REG-WU-074-RC-051-RC051-d: a prior inventory dump sidecar still round-trips and is rewritten without absolute_path", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "pack.zip"), buildZipBuffer([{ name: "readme.txt", data: Buffer.from("hello\n") }]));
    fs.writeFileSync(path.join(root, "pack.zip.l9meta.yaml"), [
      "---",
      "title: OperatorTitle",
      "artifact_id: inv-old",
      "absolute_path: /Users/someone/L9 live drive/pack.zip",
      "relative_path: pack.zip",
      "file_name: pack.zip",
      "unknowns: []",
      "created_or_detected_at: \"2026-09-11T16:22:12.503Z\"",
      "---",
      "",
    ].join("\n"));
    const result = run(root, NOW, { folderSidecars: false });
    const sidecar = fs.readFileSync(path.join(root, "pack.zip.l9meta.yaml"), "utf8");
    expect(sidecar).toContain("title: OperatorTitle");
    expect(sidecar).not.toContain("absolute_path:");
    expect(sidecar).not.toContain("/Users/someone");
    const rec = result.records.find((r) => r.relative_path === "pack.zip")!;
    expect(rec.unknowns.filter((u) => u.startsWith("sidecar_"))).toEqual([]);
  });

  test("REG-WU-074-RC-051-RC051-e: an unparseable archive sidecar is preserved and the archive member is still upserted", () => {
    const root = tmp();
    const zipPath = path.join(root, "pack.zip");
    fs.writeFileSync(zipPath, buildZipBuffer([{ name: "readme.txt", data: Buffer.from("hello\n") }]));
    const sidecar = path.join(root, "pack.zip.l9meta.yaml");
    const authored = "primary:\n  nested:\n    deeper: value\n";
    fs.writeFileSync(sidecar, authored);
    const result = run(root, NOW, { folderSidecars: false });
    expect(fs.readFileSync(sidecar, "utf8")).toBe(authored);
    expect(peekZipRootMeta(zipPath)).toContain("inventory_type: archive");
    const rec = result.records.find((r) => r.relative_path === "pack.zip")!;
    expect(rec.unknowns).toContain("sidecar_unreadable");
  });
});
