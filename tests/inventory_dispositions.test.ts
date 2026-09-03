// inventory_dispositions.test.ts — every entry the inventory meets gets a disposition.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { inventoryTree, classifyInventory } from "../src/inventory";
import { acquireLocalSource } from "../src/local_source";
import { ARCHIVE_EXTENSIONS } from "../src/archive_formats";
import { resolveStrategy } from "../src/comment";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-inventory-disp-"));
}

describe("inventory — symlinks and special entries", () => {
  test("a symlink and a FIFO are recorded, never opened, never annotated", () => {
    const root = tmp();
    const outside = path.join(tmp(), "outside.md");
    fs.writeFileSync(outside, "# outside\n");
    fs.writeFileSync(path.join(root, "real.md"), "# real\n");
    fs.symlinkSync(outside, path.join(root, "link.md"));
    fs.symlinkSync("/nonexistent/target", path.join(root, "dangling"));
    execFileSync("mkfifo", [path.join(root, "pipe")]);
    const result = inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false });
    const byPath = new Map(result.records.map((r) => [r.relative_path, r]));
    expect([...byPath.keys()].sort()).toEqual(["dangling", "link.md", "pipe", "real.md"]);
    expect(byPath.get("link.md")).toMatchObject({ artifact_type: "unknown", content_hash: null, size_bytes: null, unknowns: ["symlink_not_traversed"] });
    expect(byPath.get("dangling")).toMatchObject({ artifact_type: "unknown", unknowns: ["symlink_not_traversed"] });
    expect(byPath.get("pipe")).toMatchObject({ artifact_type: "unknown", unknowns: ["special_filesystem_entry"] });
    expect(byPath.get("real.md")?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(outside, "utf8")).toBe("# outside\n");
    expect(fs.readdirSync(root).sort()).toEqual(["dangling", "link.md", "pipe", "real.md"]);
    expect(fs.readFileSync(path.join(root, "real.md"), "utf8")).toContain("---");
  });
});

describe("inventory — deterministic record order", () => {
  test("records are in code-point order regardless of readdir order", () => {
    const root = tmp();
    for (const name of ["b.md", "a.md", "C.md", "_x.md", "10.md", "2.md", "sub"]) {
      if (name === "sub") { fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, "z.md"), "#\n"); }
      else fs.writeFileSync(path.join(root, name), "#\n");
    }
    const result = inventoryTree({ root, outDir: path.join(tmp(), "out"), dryRun: true });
    expect(result.records.map((r) => r.relative_path)).toEqual(["10.md", "2.md", "C.md", "_x.md", "a.md", "b.md", "sub", "sub/z.md"]);
  });
});

describe("archive extension authority is shared", () => {
  test("every recognized archive extension is an archive to the classifier and skip-binary to the injector", () => {
    for (const extension of ARCHIVE_EXTENSIONS) {
      expect(classifyInventory(`x${extension}`, `x${extension}`, extension, false).type, extension).toBe("archive");
      expect(resolveStrategy(`x${extension}`, "").strategy, extension).toBe("skip-binary");
    }
  });

  test("the record and the diagnostic about it tell one story", () => {
    const root = tmp();
    for (const name of ["a.tar.zst", "b.lz4", "c.cab", "d.iso", "e.jar"]) fs.writeFileSync(path.join(root, name), Buffer.from([0, 1, 2]));
    const observation = acquireLocalSource({ path: root, scratchParent: tmp() });
    const diagnosed = new Set(observation.diagnostics.filter((d) => d.code === "archive.format_not_expanded").map((d) => d.sourcePath));
    for (const record of observation.inventory.records) {
      expect(record.artifact_type, record.relative_path).toBe("archive");
      expect(diagnosed.has(record.relative_path), record.relative_path).toBe(true);
    }
    observation.dispose();
  });

  test("inventory records an archive signature its name does not declare", () => {
    const root = tmp();
    const gzip = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 3, 1, 2, 3]);
    fs.writeFileSync(path.join(root, "notes.txt"), gzip);
    const result = inventoryTree({ root, outDir: path.join(tmp(), "out"), dryRun: true });
    expect(result.records[0].unknowns).toContain("archive_signature:gzip");
  });
});
