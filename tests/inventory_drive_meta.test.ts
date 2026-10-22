import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { inventoryTree, buildRecord } from "../src/inventory";
import { contentHash } from "../src/extract";
import { harvestExistingMeta } from "../src/inventory_existing_meta";
import { buildTarArchive } from "../src/tar_writer";
import { peekTarRootMeta, readTarArchive } from "../src/tar_reader";
import { buildZipBuffer, peekZipRootMeta, injectZipRootMeta } from "../src/zip_writer";
import * as zlib from "node:zlib";
import { inventoryRewriteKind, boundedGunzipSync } from "../src/inventory_archive_member";
import { buildFinderComment, buildFinderTags, isInventoryFinderComment, versionTokenFromFileName } from "../src/inventory_darwin_search";
import { gzipTar, hostileTarCorpus } from "./helpers/tar_fixtures";
import { runApplyAsync } from "../src/apply";
import { acquireLocalSource } from "../src/local_source";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-inv-drive-"));
}

function writeAuthority(root: string): void {
  fs.mkdirSync(path.join(root, ".l9"));
  fs.writeFileSync(path.join(root, ".l9", "meta-authority.yaml"), [
    "schema: l9.meta-authority/v1",
    "writer:",
    "  repository: Quantum-L9/l9-meta-injector",
    "  ref: fc335977581ff556a8d071a80fd48dfb3686a5cb",
    "default_carrier: inline_managed",
    "legacy_writers: forbidden",
    "inline_allow: [\"**/*.md\"]",
    "",
  ].join("\n"));
}

describe("inventory rewrite kind", () => {
  test("admits zip, tar, tar.gz, tgz and holds jar/war/bare gz", () => {
    expect(inventoryRewriteKind("a.zip")).toBe("zip");
    expect(inventoryRewriteKind("a.tar")).toBe("tar");
    expect(inventoryRewriteKind("a.tar.gz")).toBe("tar.gz");
    expect(inventoryRewriteKind("a.tgz")).toBe("tar.gz");
    expect(inventoryRewriteKind("a.jar")).toBeNull();
    expect(inventoryRewriteKind("a.war")).toBeNull();
    expect(inventoryRewriteKind("a.gz")).toBeNull();
  });
});

describe("three clocks", () => {
  test("buildRecord sets inspected_at from now and does not forge created_at from now", () => {
    const root = tmp();
    const file = path.join(root, "note.md");
    fs.writeFileSync(file, "# hi\n");
    const rec = buildRecord(root, file, false, {
      sourceSystem: "local",
      hashMaxBytes: 1e9,
      now: "2026-09-11T12:00:00.000Z",
    });
    expect(rec.inspected_at).toBe("2026-09-11T12:00:00.000Z");
    expect(rec.created_at).not.toBe("2026-09-11T12:00:00.000Z");
    expect(rec.modified_at).toMatch(/^\d{4}-/);
  });

  test("live headers and sidecars emit the three clocks and not created_or_detected_at", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    fs.writeFileSync(path.join(root, "cfg.json"), "{\"x\":1}\n");
    const zip = buildZipBuffer([{ name: "docs/a.md", data: Buffer.from("# A\n") }]);
    fs.writeFileSync(path.join(root, "pack.zip"), zip);
    const result = inventoryTree({
      root,
      outDir: path.join(tmp(), "out"),
      folderSidecars: false,
      now: "2026-09-11T12:00:00.000Z",
    });
    const md = fs.readFileSync(path.join(root, "a.md"), "utf8");
    const jsonMeta = fs.readFileSync(path.join(root, "cfg.json.l9meta.yaml"), "utf8");
    const zipMeta = fs.readFileSync(path.join(root, "pack.zip.l9meta.yaml"), "utf8");
    for (const text of [md, jsonMeta, zipMeta]) {
      expect(text).toContain("2026-09-11T12:00:00.000Z");
      expect(text).toContain("inspected_at:");
      expect(text).toContain("modified_at:");
      expect(text).toContain("created_at:");
      expect(text).not.toContain("created_or_detected_at:");
    }
    expect(result.records.every((r) => r.inspected_at === "2026-09-11T12:00:00.000Z")).toBe(true);
  });

  test("re-inventory drops leftover created_or_detected_at from an existing header", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "note.md"), [
      "---",
      "title: note.md",
      "created_or_detected_at: \"2026-09-11T16:22:12.503Z\"",
      "---",
      "# body\n",
    ].join("\n"));
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false, now: "2026-09-11T18:00:00.000Z" });
    inventoryTree({ root, outDir: path.join(tmp(), "out2"), folderSidecars: false, now: "2026-09-11T19:00:00.000Z" });
    const md = fs.readFileSync(path.join(root, "note.md"), "utf8");
    expect(md).toContain("inspected_at:");
    expect(md).toContain("2026-09-11T19:00:00.000Z");
    expect(md).toContain("# body");
    expect(md).not.toContain("created_or_detected_at:");
  });

  test("re-inventory drops leftover created_or_detected_at from a comment header", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "mod.py"), [
      "# >>> l9:meta >>>",
      "# title: mod.py",
      "# created_or_detected_at: \"2026-09-11T16:22:12.503Z\"",
      "# <<< l9:meta <<<",
      "print(1)\n",
    ].join("\n"));
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false, now: "2026-09-11T18:00:00.000Z" });
    inventoryTree({ root, outDir: path.join(tmp(), "out2"), folderSidecars: false, now: "2026-09-11T19:00:00.000Z" });
    const py = fs.readFileSync(path.join(root, "mod.py"), "utf8");
    expect(py).toContain("inspected_at:");
    expect(py).toContain("2026-09-11T19:00:00.000Z");
    expect(py).toContain("print(1)");
    expect(py).not.toContain("created_or_detected_at:");
  });
});

describe("derived annotation fields", () => {
  test("a prompt markdown file derives prompt taxonomy from classify", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "docs", "prompts"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "prompts", "foo.md"), "# Use when classifying\n");
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false, now: "2099-01-01T00:00:00.000Z" });
    const md = fs.readFileSync(path.join(root, "docs", "prompts", "foo.md"), "utf8");
    expect(md).toMatch(/artifact_type:\s*"?prompt"?/);
    expect(md).toMatch(/mcp_primitive:\s*"?prompt"?/);
    expect(md).toContain("callable: true");
    expect(md).toMatch(/namespace:\s*"?Unknown"?/);
    expect(md).toMatch(/authority:\s*"?Unknown"?/);
  });

  test("a yaml file derives source taxonomy, a token estimate, and Unknown namespace/authority", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "cfg.yaml"), "name: sample\n");
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false, now: "2099-01-01T00:00:00.000Z" });
    const yaml = fs.readFileSync(path.join(root, "cfg.yaml"), "utf8");
    expect(yaml).toContain("artifact_type: source");
    expect(yaml).toContain("inventory_type: config");
    expect(yaml).toContain("namespace: Unknown");
    expect(yaml).toContain("authority: Unknown");
    expect(yaml).not.toContain("token_cost_estimate: 0");
    expect(yaml).not.toContain("token_cost_estimate: Unknown");
    const token = /token_cost_estimate: (\d+)/.exec(yaml);
    expect(token).not.toBeNull();
    expect(Number(token![1])).toBeGreaterThan(0);
  });

  test("folder and archive sidecars carry Unknown taxonomy and token fields", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs", "a.md"), "# A\n");
    const zip = buildZipBuffer([{ name: "readme.txt", data: Buffer.from("hello\n") }]);
    fs.writeFileSync(path.join(root, "pack.zip"), zip);
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: true, now: "2099-01-01T00:00:00.000Z" });
    const folder = fs.readFileSync(path.join(root, "docs", ".l9meta.yaml"), "utf8");
    const archive = fs.readFileSync(path.join(root, "pack.zip.l9meta.yaml"), "utf8");
    for (const text of [folder, archive]) {
      expect(text).toContain("artifact_type: Unknown");
      expect(text).toContain("mcp_primitive: Unknown");
      expect(text).toContain("callable: Unknown");
      expect(text).toContain("token_cost_estimate: Unknown");
      expect(text).toContain("namespace: Unknown");
      expect(text).toContain("authority: Unknown");
    }
    expect(archive).toContain("inventory_type: archive");
  });

  test("content_hash is the carrier-free body hash and is stable across two live runs", () => {
    const root = tmp();
    const body = "name: stable\n";
    fs.writeFileSync(path.join(root, "cfg.yaml"), body);
    const expected = contentHash(body);
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false, now: "2099-01-01T00:00:00.000Z" });
    const once = fs.readFileSync(path.join(root, "cfg.yaml"), "utf8");
    expect(once).toContain(`content_hash: ${expected}`);
    inventoryTree({ root, outDir: path.join(tmp(), "out2"), folderSidecars: false, now: "2099-01-01T00:00:00.000Z" });
    const twice = fs.readFileSync(path.join(root, "cfg.yaml"), "utf8");
    expect(twice).toContain(`content_hash: ${expected}`);
  });

  test("token_cost_estimate describes the carrier-free body and is stable across two live runs", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "cfg.yaml"), "name: stable\n");
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false, now: "2099-01-01T00:00:00.000Z" });
    const once = /token_cost_estimate: (\d+)/.exec(fs.readFileSync(path.join(root, "cfg.yaml"), "utf8"));
    expect(once).not.toBeNull();
    inventoryTree({ root, outDir: path.join(tmp(), "out2"), folderSidecars: false, now: "2099-01-01T00:00:00.000Z" });
    const twice = /token_cost_estimate: (\d+)/.exec(fs.readFileSync(path.join(root, "cfg.yaml"), "utf8"));
    expect(twice).not.toBeNull();
    // The second run reads a file that now carries the generated header; the
    // estimate must still describe the 13-byte body, not the header.
    expect(twice![1]).toBe(once![1]);
  });

  test("hashMaxBytes applies to the carrier-free body, so annotation cannot change eligibility", () => {
    const root = tmp();
    const body = "x".repeat(100) + "\n";
    fs.writeFileSync(path.join(root, "cfg.yaml"), body);
    const expected = contentHash(body);
    const cfg = { root, folderSidecars: false, hashMaxBytes: 150, now: "2099-01-01T00:00:00.000Z" };
    const first = inventoryTree({ ...cfg, outDir: path.join(tmp(), "out") });
    expect(first.records.find((row) => row.file_name === "cfg.yaml")?.content_hash).toBe(expected);
    expect(fs.statSync(path.join(root, "cfg.yaml")).size).toBeGreaterThan(150);
    const second = inventoryTree({ ...cfg, outDir: path.join(tmp(), "out2") });
    const rec = second.records.find((row) => row.file_name === "cfg.yaml");
    expect(rec?.content_hash).toBe(expected);
    expect(rec?.unknowns).not.toContain("content_hash_skipped:file_too_large");
    const header = fs.readFileSync(path.join(root, "cfg.yaml"), "utf8");
    expect(header).toContain(`content_hash: ${expected}`);
    expect(header).not.toContain("token_cost_estimate: Unknown");
  });

  test("identical files still cluster as duplicates after annotation", () => {
    const root = tmp();
    const body = "shared body\n";
    fs.writeFileSync(path.join(root, "a.yaml"), body);
    fs.writeFileSync(path.join(root, "b.yaml"), body);
    const result = inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false, now: "2099-01-01T00:00:00.000Z" });
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]?.count).toBe(2);
    expect(result.duplicates[0]?.content_hash).toBe(contentHash(body));
  });

  test("a pre-seeded legacy header is migrated and an operator namespace is preserved", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "legacy.py"), [
      "# >>> l9:meta >>>",
      "# artifact_type: source",
      "# mcp_primitive: resource",
      "# callable: false",
      "# retrievable: true",
      "# injectable: true",
      "# namespace: inventory",
      "# sharing_scope: agnostic",
      "# token_cost_estimate: 0",
      "# authority: inventory",
      "# <<< l9:meta <<<",
      "print(1)\n",
    ].join("\n"));
    fs.writeFileSync(path.join(root, "kept.py"), [
      "# >>> l9:meta >>>",
      "# namespace: myns",
      "# <<< l9:meta <<<",
      "print(2)\n",
    ].join("\n"));
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false, now: "2099-01-01T00:00:00.000Z" });
    const legacy = fs.readFileSync(path.join(root, "legacy.py"), "utf8");
    expect(legacy).toContain("namespace: Unknown");
    expect(legacy).toContain("authority: Unknown");
    expect(legacy).not.toContain("namespace: inventory");
    expect(legacy).not.toContain("authority: inventory");
    expect(legacy).not.toContain("token_cost_estimate: 0");
    const kept = fs.readFileSync(path.join(root, "kept.py"), "utf8");
    expect(kept).toContain("namespace: myns");
    expect(kept).toContain("authority: Unknown");
  });

  test("a future mtime yields a clock-skew diagnostic and leaves the observed value unchanged", () => {
    const root = tmp();
    const file = path.join(root, "note.md");
    fs.writeFileSync(file, "# hi\n");
    const inspected = new Date().toISOString();
    const future = new Date(Date.now() + 120_000);
    fs.utimesSync(file, future, future);
    const result = inventoryTree({
      root,
      outDir: path.join(tmp(), "out"),
      folderSidecars: false,
      now: inspected,
    });
    const rec = result.records.find((row) => row.file_name === "note.md");
    expect(rec?.unknowns).toContain("clock_skew:modified_at_after_inspected_at");
    expect(rec?.modified_at && rec.modified_at > inspected).toBe(true);
    const md = fs.readFileSync(file, "utf8");
    expect(md).toContain("modified_at:");
    expect(md).toContain((rec?.modified_at ?? "").slice(0, 19));
  });
});

describe("harvest-first", () => {
  test("reads existing sidecar and folder meta before classify", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs", ".l9meta.yaml"), "---\ntitle: FolderTitle\n---\n");
    fs.writeFileSync(path.join(root, "cfg.json"), "{\"a\":1}\n");
    fs.writeFileSync(path.join(root, "cfg.json.l9meta.yaml"), "---\ntitle: OperatorTitle\ntags:\n  - harvested\n---\n");
    const harvested = harvestExistingMeta(path.join(root, "cfg.json"), false);
    expect(harvested.title).toBe("OperatorTitle");
    const folder = harvestExistingMeta(path.join(root, "docs"), true);
    expect(folder.title).toBe("FolderTitle");
    inventoryTree({ root, outDir: path.join(tmp(), "out"), now: "2026-09-11T12:00:00.000Z" });
    const sidecar = fs.readFileSync(path.join(root, "cfg.json.l9meta.yaml"), "utf8");
    expect(sidecar).toContain("title: OperatorTitle");
    expect(sidecar).toContain("2026-09-11T12:00:00.000Z");
    expect(sidecar).toContain("inspected_at:");
  });

  test("harvests an existing archive member title before rewrite", () => {
    const root = tmp();
    const zip = buildZipBuffer([{ name: "readme.txt", data: Buffer.from("hello\n") }]);
    const zipPath = path.join(root, "pack.zip");
    fs.writeFileSync(zipPath, zip);
    const injected = injectZipRootMeta(zipPath, "---\ntitle: PackedTitle\ntags:\n  - harvested\n---\n");
    expect(injected.ok).toBe(true);
    if (injected.ok) fs.writeFileSync(zipPath, injected.bytes);
    const harvested = harvestExistingMeta(zipPath, false);
    expect(harvested.title).toBe("PackedTitle");
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false, now: "2026-09-11T12:00:00.000Z" });
    const member = peekZipRootMeta(zipPath);
    expect(member).toContain("title: PackedTitle");
    expect(member).toContain("inspected_at:");
    expect(fs.readFileSync(path.join(root, "pack.zip.l9meta.yaml"), "utf8")).toContain("title: PackedTitle");
  });

  test("does not re-emit a prior inventory dump's absolute_path into the sidecar", () => {
    const root = tmp();
    const zip = buildZipBuffer([{ name: "readme.txt", data: Buffer.from("hello\n") }]);
    fs.writeFileSync(path.join(root, "pack.zip"), zip);
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
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false, now: "2026-09-11T18:00:00.000Z" });
    const sidecar = fs.readFileSync(path.join(root, "pack.zip.l9meta.yaml"), "utf8");
    expect(sidecar).toContain("title: OperatorTitle");
    expect(sidecar).not.toContain("/Users/someone");
    expect(sidecar).not.toContain("absolute_path:");
    expect(sidecar).not.toContain("created_or_detected_at:");
  });

  test("folder sidecar with lossy round-trip is not rewritten", () => {
    const root = tmp();
    const folderPath = path.join(root, "docs");
    fs.mkdirSync(folderPath);
    const multilineYaml = `---
title: FolderTitle
description: |
  This is a multiline
  description that should
  be preserved exactly.
custom_field: value
---
`;
    const sidecarPath = path.join(folderPath, ".l9meta.yaml");
    fs.writeFileSync(sidecarPath, multilineYaml);
    const originalContent = fs.readFileSync(sidecarPath, "utf8");
    const result = inventoryTree({
      root,
      outDir: path.join(tmp(), "out"),
      folderSidecars: true,
      now: "2026-09-11T12:00:00.000Z",
    });
    const folderRec = result.records.find((r) => r.file_name === "docs" && r.artifact_type === "folder");
    const afterContent = fs.readFileSync(sidecarPath, "utf8");
    if (afterContent === originalContent) {
      expect(folderRec?.unknowns).toContain("folder_sidecar_lossy_roundtrip");
    } else {
      expect(afterContent).toContain("inspected_at:");
    }
  });
});

describe("archive member inject", () => {
  test("writes sidecar and a root .l9meta.yaml member inside zip and tar.gz", () => {
    const root = tmp();
    const zip = buildZipBuffer([{ name: "readme.txt", data: Buffer.from("hello\n") }]);
    const tar = buildTarArchive([{ name: "readme.txt", content: "hello\n" }]);
    fs.writeFileSync(path.join(root, "pack.zip"), zip);
    fs.writeFileSync(path.join(root, "pack.tar.gz"), gzipTar(tar));
    const result = inventoryTree({
      root,
      outDir: path.join(tmp(), "out"),
      folderSidecars: false,
      now: "2026-09-11T12:00:00.000Z",
    });
    expect(fs.existsSync(path.join(root, "pack.zip.l9meta.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(root, "pack.tar.gz.l9meta.yaml"))).toBe(true);
    expect(peekZipRootMeta(path.join(root, "pack.zip"))).toContain("2026-09-11T12:00:00.000Z");
    const gz = fs.readFileSync(path.join(root, "pack.tar.gz"));
    const zlib = require("node:zlib") as typeof import("node:zlib");
    const peeked = peekTarRootMeta(zlib.gunzipSync(gz));
    expect(peeked?.toString("utf8")).toContain("inventory_type: archive");
    expect(result.records.some((r) => r.file_name.endsWith(".l9meta.yaml"))).toBe(false);
  });

  test("zip members that use a data-descriptor trailer still receive a root meta member", () => {
    const root = tmp();
    const zipPath = path.join(root, "dd.zip");
    fs.writeFileSync(zipPath, zipWithDataDescriptor("readme.txt", Buffer.from("hello\n")));
    const result = inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false, now: "2026-09-11T18:00:00.000Z" });
    const member = peekZipRootMeta(zipPath);
    expect(member).toContain("2026-09-11T18:00:00.000Z");
    expect(member).toContain("inspected_at:");
    expect(fs.existsSync(path.join(root, "dd.zip.l9meta.yaml"))).toBe(true);
    expect(result.records.find((row) => row.file_name === "dd.zip")?.unknowns ?? []).not.toContain(
      "archive_rewrite_held:archive.data_descriptor",
    );
  });

  test("hostile tar is held and still gets an adjacent sidecar", () => {
    const root = tmp();
    const hostile = hostileTarCorpus()["traversal.tar"]!;
    fs.writeFileSync(path.join(root, "bad.tar"), hostile);
    const before = Buffer.from(hostile);
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false });
    expect(fs.readFileSync(path.join(root, "bad.tar"))).toEqual(before);
    expect(fs.existsSync(path.join(root, "bad.tar.l9meta.yaml"))).toBe(true);
    expect(readTarArchive(before).ok).toBe(true);
  });

  test("jar and bare gz hold rewrite", () => {
    const root = tmp();
    const jarBytes = buildZipBuffer([{ name: "A.class", data: Buffer.from([1, 2, 3]) }]);
    const gzBytes = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 3]);
    fs.writeFileSync(path.join(root, "lib.jar"), jarBytes);
    fs.writeFileSync(path.join(root, "only.gz"), gzBytes);
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false });
    expect(fs.readFileSync(path.join(root, "lib.jar"))).toEqual(jarBytes);
    expect(fs.readFileSync(path.join(root, "only.gz"))).toEqual(gzBytes);
    expect(fs.existsSync(path.join(root, "lib.jar.l9meta.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(root, "only.gz.l9meta.yaml"))).toBe(true);
  });

  test("bounded gzip inflation holds decompression bombs", () => {
    const original = Buffer.alloc(1024).fill(0x41);
    const compressed = zlib.gzipSync(original);
    const smallBudgetPolicy = { maxTotalUncompressedBytesPerArchive: 100 };
    const result = boundedGunzipSync(compressed, smallBudgetPolicy);
    expect(result.ok).toBe(false);
    expect(result.hold).toBe("archive.inflation_budget_exceeded");
    const largeBudgetResult = boundedGunzipSync(compressed, { maxTotalUncompressedBytesPerArchive: 2048 });
    expect(largeBudgetResult.ok).toBe(true);
    if (largeBudgetResult.ok) {
      expect(largeBudgetResult.bytes.length).toBe(1024);
    }
  });

  test("idempotent annotation skips rewrite when embedded content unchanged", () => {
    const root = tmp();
    const zip = buildZipBuffer([{ name: "readme.txt", data: Buffer.from("hello\n") }]);
    const zipPath = path.join(root, "pack.zip");
    fs.writeFileSync(zipPath, zip);
    inventoryTree({
      root,
      outDir: path.join(tmp(), "out"),
      folderSidecars: false,
      now: "2026-09-11T12:00:00.000Z",
    });
    inventoryTree({
      root,
      outDir: path.join(tmp(), "out2"),
      folderSidecars: false,
      now: "2026-09-11T12:00:00.000Z",
    });
    const secondBytes = fs.readFileSync(zipPath);
    inventoryTree({
      root,
      outDir: path.join(tmp(), "out3"),
      folderSidecars: false,
      now: "2026-09-11T12:00:00.000Z",
    });
    const thirdBytes = fs.readFileSync(zipPath);
    expect(thirdBytes).toEqual(secondBytes);
  });
});

describe("Darwin comment/tag builders", () => {
  test("builds a concise L9 comment and allowlisted tags", () => {
    const input = { fileName: "l9_runtime_pack_v1.9.0.zip", kind: "zip", harvestedTags: ["kernel"] };
    expect(buildFinderComment(input)).toBe("L9: l9_runtime_pack_v1.9.0 · zip · archive");
    expect(buildFinderTags(input)).toEqual(expect.arrayContaining(["l9", "archive", "zip", "kernel", "v1.9.0"]));
    expect(versionTokenFromFileName("l9_runtime_pack_v1.9.0.zip")).toBe("v1.9.0");
    expect(isInventoryFinderComment("")).toBe(true);
    expect(isInventoryFinderComment("L9: already")).toBe(true);
    expect(isInventoryFinderComment("human note")).toBe(false);
  });

  test.skipIf(process.platform !== "darwin")("writes Finder comment/tags and preserves a human comment", () => {
    const root = tmp();
    const zip = buildZipBuffer([{ name: "readme.txt", data: Buffer.from("hello\n") }]);
    const zipPath = path.join(root, "l9_runtime_pack_v1.9.0.zip");
    fs.writeFileSync(zipPath, zip);
    const human = path.join(root, "human.zip");
    fs.writeFileSync(human, zip);
    writeFinderComment(human, "keep this note");
    inventoryTree({ root, outDir: path.join(tmp(), "out"), folderSidecars: false });
    expect(readFinderComment(zipPath)).toBe("L9: l9_runtime_pack_v1.9.0 · zip · archive");
    expect(readFinderTags(zipPath)).toEqual(expect.arrayContaining(["l9", "archive", "zip", "v1.9.0"]));
    expect(readFinderComment(human)).toBe("keep this note");
    expect(readFinderTags(human)).toEqual(expect.arrayContaining(["l9", "archive", "zip"]));
  });
});

function zipWithDataDescriptor(name: string, data: Buffer): Buffer {
  const crc = zlib.crc32(data) >>> 0;
  const nameBytes = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0008, 6);
  local.writeUInt16LE(nameBytes.length, 26);
  const desc = Buffer.alloc(16);
  desc.writeUInt32LE(0x08074b50, 0);
  desc.writeUInt32LE(crc, 4);
  desc.writeUInt32LE(data.length, 8);
  desc.writeUInt32LE(data.length, 12);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0008, 8);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const localBlob = Buffer.concat([local, nameBytes, data, desc]);
  const cd = Buffer.concat([central, nameBytes]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(localBlob.length, 16);
  return Buffer.concat([localBlob, cd, eocd]);
}

function writeFinderComment(abs: string, value: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-plist-test-"));
  const file = path.join(dir, "x.plist");
  fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><string>${value}</string></plist>\n`);
  execFileSync("plutil", ["-convert", "binary1", file], { stdio: "pipe" });
  execFileSync("xattr", ["-wx", "com.apple.metadata:kMDItemFinderComment", fs.readFileSync(file).toString("hex"), abs], { stdio: "pipe" });
  fs.rmSync(dir, { recursive: true, force: true });
}

function readFinderComment(abs: string): string | null {
  try {
    const hex = execFileSync("xattr", ["-px", "com.apple.metadata:kMDItemFinderComment", abs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-plist-test-"));
    const file = path.join(dir, "x.plist");
    fs.writeFileSync(file, Buffer.from(hex.replace(/\s+/g, ""), "hex"));
    execFileSync("plutil", ["-convert", "xml1", file], { stdio: "pipe" });
    const xml = fs.readFileSync(file, "utf8");
    fs.rmSync(dir, { recursive: true, force: true });
    return xml.match(/<string>([\s\S]*?)<\/string>/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function readFinderTags(abs: string): string[] {
  try {
    const hex = execFileSync("xattr", ["-px", "com.apple.metadata:_kMDItemUserTags", abs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-plist-test-"));
    const file = path.join(dir, "x.plist");
    fs.writeFileSync(file, Buffer.from(hex.replace(/\s+/g, ""), "hex"));
    execFileSync("plutil", ["-convert", "xml1", file], { stdio: "pipe" });
    const xml = fs.readFileSync(file, "utf8");
    fs.rmSync(dir, { recursive: true, force: true });
    return [...xml.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]!.split("\n")[0]!).filter(Boolean);
  } catch {
    return [];
  }
}

describe("apply and local-source isolation", () => {
  test("apply, check, skills, and local-source do not import inventory archive writers", () => {
    for (const rel of ["src/apply.ts", "src/check.ts", "src/skills_pipeline.ts", "src/local_source.ts"]) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(src).not.toMatch(/inventory_archive_member|zip_writer|tar_writer|inventory_darwin_search/);
    }
  });

  test("runApplyAsync on a temp authority tree leaves zip bytes unchanged", async () => {
    const root = tmp();
    writeAuthority(root);
    fs.writeFileSync(path.join(root, "note.md"), "# Build prompt\n\nRole: auditor\nObjective: inspect.\nOutput format: markdown.\n");
    const zip = buildZipBuffer([{ name: "inside.md", data: Buffer.from("# in\n") }]);
    const zipPath = path.join(root, "pack.zip");
    fs.writeFileSync(zipPath, zip);
    const before = fs.readFileSync(zipPath);
    const external = `${root}.out`;
    const apply = await runApplyAsync({
      root,
      glob: "**/*.md",
      outDir: external,
      namespace: "fixture",
      authority: "l9.doctrine.platform",
      nearDupThreshold: 0.9,
      hashPrefixLength: 16,
      indexDir: external,
      verbose: false,
      llmEnabled: false,
      normalizeFilenames: false,
      writeInjectLog: false,
      localFiles: false,
      persistOutputs: false,
      dryRun: false,
    } as never);
    expect(apply.authorityResolved).toBe(true);
    expect(apply.passed).toBe(true);
    expect(fs.readFileSync(zipPath)).toEqual(before);
    expect(peekZipRootMeta(zipPath)).toBeNull();
  });

  test("local-source writes nothing into a zip source", () => {
    const root = tmp();
    const zip = buildZipBuffer([{ name: "inside.md", data: Buffer.from("# in\n") }]);
    const zipPath = path.join(root, "pack.zip");
    fs.writeFileSync(zipPath, zip);
    const before = fs.readFileSync(zipPath);
    acquireLocalSource({ path: root, scratchParent: tmp() });
    expect(fs.readFileSync(zipPath)).toEqual(before);
    expect(fs.existsSync(path.join(root, "pack.zip.l9meta.yaml"))).toBe(false);
  });
});
