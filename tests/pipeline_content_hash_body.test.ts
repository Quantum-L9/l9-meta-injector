/**
 * WU-012 — the pipeline's content_hash covers exactly the body the patcher preserves
 * (RC-022 / F-102).
 *
 * The pipeline used the loose `splitContent` fence detector to pick the hashed body of a
 * markdown file. For a document whose leading `---` block the patcher rejects (a thematic
 * break, complex YAML, a `----` line), that dropped the leading section from the hash, so
 * edits there were invisible to content_hash and to check's index drift. The injector and
 * inventory already hash `managedCarrierFreeBody`: inspection.body when the header is
 * safe, the whole document otherwise.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runPipelineAsync } from "../src/pipeline";
import type { PipelineConfig, PipelineResult } from "../src/schema";
import { contentHash, splitContent } from "../src/extract";
import { managedCarrierFreeBody } from "../src/inject";
import { inspectFrontMatterDocument } from "../src/frontmatter_patch";
import { runApplyAsync } from "../src/apply";
import { runCheckAsync, type CheckConfig } from "../src/check";

const dirs: string[] = [];

function tmpDir(prefix = "l9-wu012-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(`${dir}.out`, { recursive: true, force: true });
  }
});

function cfg(root: string, dryRun = true, glob = "**/*.md"): PipelineConfig {
  const out = `${root}.out`;
  return {
    root, glob, dryRun, outDir: out, indexDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    verbose: false, llmEnabled: false, normalizeFilenames: false,
  };
}

function hashFor(result: PipelineResult, relative: string): string | undefined {
  return result.metadataSubjects.find((s) => s.path === relative)?.contentHash;
}

const THEMATIC_BREAK = (intro: string) => `---\n\n${intro}\n\n---\n\nTail\n`;
const COMPLEX = (value: number) => `---\nk:\n  a: ${value}\n---\nBody\n`;
const DASH4 = "---\ntitle: x\n----\nmore: y\n---\nAfter the fence.\n";

describe("WU-012 unsafe leading blocks are part of the hashed body", () => {
  test("REG-WU-012-RC-022-a: editing the section before a thematic break changes contentHash", async () => {
    const root = tmpDir();
    const fp = path.join(root, "doc.md");
    fs.writeFileSync(fp, THEMATIC_BREAK("Intro A"));
    expect(inspectFrontMatterDocument(THEMATIC_BREAK("Intro A")).safe).toBe(false);
    const first = hashFor(await runPipelineAsync(cfg(root)), "doc.md");
    fs.writeFileSync(fp, THEMATIC_BREAK("Intro B"));
    const second = hashFor(await runPipelineAsync(cfg(root)), "doc.md");
    expect(first).toBeDefined();
    expect(second).not.toBe(first);
    expect(second).toBe(contentHash(THEMATIC_BREAK("Intro B")));
  }, 20000);

  test("REG-WU-012-RC-022-b: editing a complex (unpatchable) header changes contentHash", async () => {
    const root = tmpDir();
    const fp = path.join(root, "doc.md");
    fs.writeFileSync(fp, COMPLEX(1));
    const first = hashFor(await runPipelineAsync(cfg(root)), "doc.md");
    fs.writeFileSync(fp, COMPLEX(2));
    const second = hashFor(await runPipelineAsync(cfg(root)), "doc.md");
    expect(second).not.toBe(first);
    expect(second).toBe(contentHash(managedCarrierFreeBody(fp, COMPLEX(2))));
  }, 20000);

  test("REG-WU-012-RC-022-c: a '----' line inside the header hashes the whole document", async () => {
    const root = tmpDir();
    const fp = path.join(root, "doc.md");
    fs.writeFileSync(fp, DASH4);
    const result = await runPipelineAsync(cfg(root));
    expect(managedCarrierFreeBody(fp, DASH4)).toBe(DASH4);
    expect(hashFor(result, "doc.md")).toBe(contentHash(DASH4));
    expect(hashFor(result, "doc.md")).not.toBe(contentHash(splitContent(DASH4).body));
  }, 20000);
});

describe("WU-012 hashes for safe and header-less files are unchanged", () => {
  const BOM = "﻿";
  const SAFE = {
    "lf.md": "---\ntitle: LF\n---\n\n# LF\n\nBody.\n",
    "crlf.md": "---\r\ntitle: CRLF\r\n---\r\n\r\n# CRLF\r\n\r\nBody.\r\n",
    "bom.md": `${BOM}---\ntitle: BOM\n---\n\n# BOM\n\nBody.\n`,
  } as const;

  test("REG-WU-012-RC-022-d: safe frontmatter (LF, CRLF, BOM) hashes are stable across a real run and equal the pre-fix value", async () => {
    const root = tmpDir();
    for (const [name, content] of Object.entries(SAFE)) fs.writeFileSync(path.join(root, name), content);

    const before = await runPipelineAsync(cfg(root));
    for (const [name, content] of Object.entries(SAFE)) {
      // The pre-fix producer hashed splitContent(raw).body; for a safe header it equals
      // the patcher-preserved body.
      expect(hashFor(before, name)).toBe(contentHash(splitContent(content).body));
      expect(hashFor(before, name)).toBe(contentHash(managedCarrierFreeBody(path.join(root, name), content)));
    }

    const real = await runPipelineAsync(cfg(root, false));
    expect(real.injected.length).toBe(3);
    const after = await runPipelineAsync(cfg(root));
    for (const name of Object.keys(SAFE)) {
      expect(fs.readFileSync(path.join(root, name), "utf8")).not.toBe(SAFE[name as keyof typeof SAFE]);
      expect(hashFor(real, name)).toBe(hashFor(before, name));
      expect(hashFor(after, name)).toBe(hashFor(before, name));
    }
  }, 30000);

  test("REG-WU-012-RC-022-e: header-less markdown and a YAML file starting with '---' keep their hashes", async () => {
    const root = tmpDir();
    const md = "# Plain\n\nNo frontmatter here.\n";
    const yaml = "---\nkey: value\nother: 2\n";
    fs.writeFileSync(path.join(root, "plain.md"), md);
    fs.writeFileSync(path.join(root, "config.yaml"), yaml);

    const result = await runPipelineAsync(cfg(root, true, "**/*"));
    expect(hashFor(result, "plain.md")).toBe(contentHash(splitContent(md).body));
    expect(hashFor(result, "plain.md")).toBe(contentHash(md));
    expect(hashFor(result, "config.yaml")).toBe(contentHash(yaml));
  }, 20000);
});

function authority(): string {
  return [
    "schema: l9.meta-authority/v1",
    "writer:",
    "  repository: Quantum-L9/l9-meta-injector",
    "  ref: v4.0.0",
    "default_carrier: inline_managed",
    "legacy_writers: migration_only",
    'inline_allow: ["**/*.md"]',
    "",
  ].join("\n");
}

function governed(root: string): CheckConfig {
  const external = `${root}.out`;
  return {
    root, glob: "**/*.md", outDir: external, namespace: "fixture",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: external, verbose: false, llmEnabled: false, normalizeFilenames: false,
    writeInjectLog: false, localFiles: false, persistOutputs: false,
  };
}

describe("WU-012 governed check sees edits in an unsafe leading section", () => {
  function seed(): string {
    const root = tmpDir("l9-wu012-gov-");
    fs.mkdirSync(path.join(root, ".l9"), { recursive: true });
    fs.writeFileSync(path.join(root, ".l9", "meta-authority.yaml"), authority(), "utf8");
    // A valid-but-unpatchable header (a patcher limitation, not malformed): apply routes
    // it to the central manifest and continues (ADR-035).
    fs.writeFileSync(path.join(root, "doc.md"), COMPLEX(1));
    fs.writeFileSync(path.join(root, "guide.md"), "# Guide\n\nOrdinary prose.\n");
    return root;
  }

  test("REG-WU-012-RC-022-f: editing the leading section after apply is reported as drift", async () => {
    const root = seed();
    const applied = await runApplyAsync(governed(root));
    expect(applied.passed).toBe(true);
    expect(fs.readFileSync(path.join(root, "doc.md"), "utf8")).toBe(COMPLEX(1));
    const clean = await runCheckAsync(governed(root));
    expect(clean.check?.drift).toEqual([]);

    fs.writeFileSync(path.join(root, "doc.md"), COMPLEX(2));
    const check = await runCheckAsync(governed(root));
    expect(check.passed).toBe(false);
    // The file's identity lives in the central metadata index (its header is never
    // inline-patched), so the edit surfaces as that index going stale.
    expect(check.check?.drift).toEqual([
      expect.objectContaining({ path: ".l9/metadata-index.jsonl", kind: "stale" }),
    ]);
    const indexed = fs.readFileSync(path.join(root, ".l9", "metadata-index.jsonl"), "utf8")
      .split("\n").filter((line) => line.includes("doc.md"));
    expect(indexed.length).toBe(1);
    expect(indexed[0]).toContain(contentHash(COMPLEX(1)));
  }, 30000);

  test("REG-WU-012-RC-022-g: a second apply with no edits writes nothing", async () => {
    const root = seed();
    await runApplyAsync(governed(root));
    const second = await runApplyAsync(governed(root));
    expect(second.passed).toBe(true);
    expect(second.apply?.changed).toBe(0);
    expect(second.apply?.transaction.plannedWrites).toBe(0);
  }, 30000);
});
