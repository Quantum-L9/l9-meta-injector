// namespace_unicode_identity.test.ts — WU-016 / RC-023 / F-103 (ADR-071).
//
// Identity stems represent non-ASCII path segments instead of erasing them: after NFC
// normalisation and lower-casing, every non-ASCII code point becomes the ASCII token
// `u<lowercase hex>`, separated by `_`. ASCII-only paths keep their ids exactly.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, test } from "vitest";
import { resolveNamespace, toSnakeStem } from "../src/namespace";
import { runPipelineAsync } from "../src/pipeline";
import type { PipelineConfig } from "../src/schema";

const base = { namespace: "l9", authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16, outputDir: ".out", indexDir: "." };
const id = (p: string, hint = "context"): string => resolveNamespace(p, base, hint).idStem;

describe("WU-016: identity stems for non-ASCII path segments", () => {
  it("REG-WU-016-RC-023-a: two all-non-ASCII names in one folder get distinct ids", () => {
    expect(id("docs/日本.md")).not.toBe(id("docs/中文.md"));
    expect(id("docs/日本.md")).toBe("l9.context.docs_u65e5_u672c__md");
    expect(id("docs/中文.md")).toBe("l9.context.docs_u4e2d_u6587__md");
  });

  it("REG-WU-016-RC-023-b: an all-non-ASCII segment is not erased", () => {
    expect(id("docs/日本.md")).not.toBe(id("docs.md"));
  });

  it("REG-WU-016-RC-023-c: partially non-ASCII names and non-ASCII folders stay distinct from their ASCII remainder", () => {
    expect(id("notes/résumé.md")).not.toBe(id("notes/r_sum.md"));
    expect(id("notes/résumé.md")).toBe("l9.context.notes_r_ue9_sum_ue9__md");
    expect(id("é/x.md")).not.toBe(id("x.md"));
    expect(id("é/x.md")).toBe("l9.context.ue9_x__md");
  });

  it("REG-WU-016-RC-023-d: NFC and NFD spellings of one name get one id", () => {
    const composed = "notes/résumé.md";
    const decomposed = "notes/résumé.md";
    expect(composed).not.toBe(decomposed);
    expect(id(composed)).toBe(id(decomposed));
  });

  it("REG-WU-016-RC-023-e: case folding matches ASCII lower-casing", () => {
    expect(id("É.md")).toBe(id("é.md"));
    expect(id("README.md")).toBe(id("readme.md"));
  });

  it("REG-WU-016-RC-023-f: ASCII ids are unchanged", () => {
    expect(id("config.ts", "source")).toBe("l9.source.config__ts");
    expect(id("config.json", "source")).toBe("l9.source.config__json");
    expect(id("a-b.md")).toBe(id("a_b.md"));
    expect(id("a-b.md")).toBe("l9.context.a_b__md");
    expect(id("src/index.ts", "source")).toBe("l9.source.src_index__ts");
    expect(id("lib/index.ts", "source")).toBe("l9.source.lib_index__ts");
    expect(id("/repos/l9/src/index.ts", "source")).toBe("l9.source.index__ts");
    expect(id("src/MyWidget.tsx", "source")).toBe("l9.source.src_my_widget__tsx");
    expect(id("docs/with space.md")).toBe("l9.context.docs_with_space__md");
    // toSnakeStem (public advanced export) is not part of identity and keeps its output.
    expect(toSnakeStem("résumé.md")).toBe("r_sum");
  });

  it("REG-WU-016-RC-023-g: non-ASCII ids stay within [a-z0-9_.] and emit '__' only as the extension separator", () => {
    const samples = [
      "docs/日本.md", "notes/résumé.md", "é/x.md", "Ünïcödé/Straße.TXT", "emoji/😀 file.md",
      "mixed/naïve-Café.md", "deep/日本/中文/ファイル.md", "nbsp/a b.md", "x.日本",
    ];
    for (const sample of samples) {
      const stem = id(sample);
      expect(stem).toMatch(/^[a-z0-9_.]+$/);
      const tail = stem.slice("l9.context.".length);
      const separators = tail.match(/__/g) ?? [];
      expect(separators.length).toBeLessThanOrEqual(1);
      if (separators.length === 1) expect(tail).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*__[a-z0-9]+(?:_[a-z0-9]+)*$/);
    }
    expect(id("emoji/😀 file.md")).toBe("l9.context.emoji_u1f600_file__md");
    expect(id("x.日本")).toBe("l9.context.x__u65e5_u672c");
  });
});

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-wu016-"));
}

function pipelineConfig(root: string, out: string): PipelineConfig {
  return {
    root, glob: "**/*.md", dryRun: true, outDir: out, indexDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    verbose: false, llmEnabled: false, normalizeFilenames: false,
  };
}

describe("WU-016: pipeline over non-ASCII names", () => {
  test("REG-WU-016-RC-023-h: distinct non-ASCII names in one folder are governed, not refused", async () => {
    const root = tmpDir();
    const out = tmpDir();
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs", "日本.md"), "## Japan\nnotes\n");
    fs.writeFileSync(path.join(root, "docs", "中文.md"), "## Chinese\nnotes\n");
    const result = await runPipelineAsync(pipelineConfig(root, out));
    expect(result.metadataSubjects).toHaveLength(2);
    const ids = result.metadataSubjects.map((s) => String(s.metadata.id)).sort();
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(["l9.context.docs_u4e2d_u6587__md", "l9.context.docs_u65e5_u672c__md"]);
  }, 15000);

  test("REG-WU-016-RC-023-i: a hyphen/underscore collision still refuses before any write", async () => {
    const root = tmpDir();
    const out = tmpDir();
    fs.writeFileSync(path.join(root, "a-b.md"), "## A\nbody\n");
    fs.writeFileSync(path.join(root, "a_b.md"), "## B\nbody\n");
    await expect(runPipelineAsync(pipelineConfig(root, out))).rejects.toThrow(/DUPLICATE_METADATA_ID: 1 id\(s\) map to more than one path: .*a_b__md: a-b\.md, a_b\.md/);
    expect(fs.readFileSync(path.join(root, "a-b.md"), "utf8")).toBe("## A\nbody\n");
    expect(fs.existsSync(path.join(out, "coverage-report.json"))).toBe(false);
  }, 15000);
});
