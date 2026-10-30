// inventory_content_identity.test.ts — what inventory content_hash covers for a
// YAML front-matter document, and what an inventory duplicate cluster therefore
// means (ADR-065, RC-052).
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { inventoryTree } from "../src/inventory";
import { classify } from "../src/classify";
import { contentHash, extract } from "../src/extract";
import { injectFile } from "../src/inject";
import { buildMeta } from "../src/normalize_meta";
import type { NamespaceConfig } from "../src/namespace";

const roots: string[] = [];
function tmp(prefix = "l9-inv-identity-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const NOW = "2030-01-01T00:00:00.000Z";
const BODY = "# Plan\n\nShip the thing.\n";
const sha256 = (text: string): string => crypto.createHash("sha256").update(text).digest("hex");

function hashOf(root: string, rel: string, dryRun: boolean): string | null | undefined {
  const result = inventoryTree({ root, outDir: path.join(tmp("l9-inv-identity-out-"), "out"), dryRun, folderSidecars: false, now: NOW });
  return result.records.find((r) => r.relative_path === rel)?.content_hash;
}

describe("WU-075 RC-052: front matter is the inventory metadata carrier", () => {
  test("REG-WU-075-RC-052-RC052-a: documents differing only in front matter form one cluster that is not reported as byte duplicates", () => {
    const root = tmp();
    const a = `---\nstatus: draft\nowner: ana\n---\n${BODY}`;
    const b = `---\nstatus: approved\nowner: ben\n---\n${BODY}`;
    fs.writeFileSync(path.join(root, "a.md"), a);
    fs.writeFileSync(path.join(root, "b.md"), b);
    const out = path.join(tmp("l9-inv-identity-out-"), "out");
    const result = inventoryTree({ root, outDir: out, dryRun: true, folderSidecars: false, now: NOW });
    expect(sha256(a)).not.toBe(sha256(b));
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]?.paths).toEqual(["a.md", "b.md"]);
    expect(result.duplicates[0]?.content_hash).toBe(contentHash(BODY));

    const md = fs.readFileSync(result.manifestPaths.md, "utf8");
    expect(md).not.toMatch(/recoverable/i);
    expect(md).not.toMatch(/byte[- ]identical/i);
    expect(md).toContain("same carrier-free content");
    expect(md).toMatch(/front matter[^\n]*may differ/i);
  });

  test("REG-WU-075-RC-052-RC052-b: an unannotated document and the same document after one live annotation share content_hash", () => {
    const plain = tmp();
    const annotated = tmp();
    const doc = `---\nstatus: draft\n---\n${BODY}`;
    fs.writeFileSync(path.join(plain, "doc.md"), doc);
    fs.writeFileSync(path.join(annotated, "doc.md"), doc);
    inventoryTree({ root: annotated, outDir: path.join(tmp("l9-inv-identity-out-"), "out"), folderSidecars: false, now: NOW });
    expect(fs.readFileSync(path.join(annotated, "doc.md"), "utf8")).toContain("inspected_at:");
    expect(hashOf(annotated, "doc.md", true)).toBe(hashOf(plain, "doc.md", true));
    expect(hashOf(plain, "doc.md", true)).toBe(contentHash(BODY));
  });

  test("REG-WU-075-RC-052-RC052-c: a document with user front matter keeps its content_hash across two live runs", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "doc.md"), `---\nstatus: draft\ntags: [a, b]\nowner: "ana"\n---\n${BODY}`);
    const first = hashOf(root, "doc.md", false);
    const second = hashOf(root, "doc.md", false);
    expect(first).toBe(contentHash(BODY));
    expect(second).toBe(first);
  });

  test("REG-WU-075-RC-052-RC052-d: pipeline injection still hashes the post-fence body as originalBodyHash", () => {
    const root = tmp();
    const fp = path.join(root, "guide.md");
    fs.writeFileSync(fp, `---\nstatus: draft\n---\n${BODY}`);
    const ns: NamespaceConfig = {
      namespace: "l9", authority: "l9.auto", nearDupThreshold: 0.9,
      hashPrefixLength: 16, outputDir: ".out", indexDir: ".",
    };
    const meta = buildMeta(fp, BODY, extract(BODY), classify(fp, BODY, "none"), ns, "l9.auto", NOW);
    const rec = injectFile(fp, meta, { dryRun: false, outDir: tmp(), verbose: false, writeInjectLog: false });
    expect(rec.originalBodyHash).toBe(contentHash(BODY));
    expect(rec.postInjectionBodyHash).toBe(contentHash(BODY));
    expect(rec.bodyPreserved).toBe(true);
    expect(fs.readFileSync(fp, "utf8")).toMatch(/status: "?draft"?/);
  });
});
