// duplicate_id_refusal_order.test.ts — WU-011 / RC-020 / F-034.
//
// A DUPLICATE_METADATA_ID refusal that is decidable from the tree as it stands must
// happen before any stage that writes into the tree: archive expansion (local-files)
// and normalize sidecars. Collisions introduced only by extracted archive members are
// the documented residual (ADR-073): they still refuse, after extraction.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { runPipelineAsync } from "../src/pipeline";
import type { PipelineConfig } from "../src/schema";
import { treeSnapshot, writeRawZip } from "./helpers/zip_fixtures";

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cfg(root: string, out: string, overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    root, glob: "**/*", dryRun: false, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
    writeInjectLog: false, ...overrides,
  };
}

function listRecursive(root: string): string[] {
  return (fs.readdirSync(root, { recursive: true }) as string[]).map((p) => p.split(path.sep).join("/")).sort();
}

describe("WU-011: duplicate-id refusal precedes tree mutation", () => {
  test("REG-WU-011-RC-020-a: pre-existing collision refuses a local-files real run before any archive is expanded", async () => {
    const root = tmp("l9-dupord-a-");
    const out = tmp("l9-dupord-a-out-");
    fs.writeFileSync(path.join(root, "a-b.md"), "## A\nbody\n");
    fs.writeFileSync(path.join(root, "a_b.md"), "## B\nbody\n");
    writeRawZip(path.join(root, "bundle.zip"), [{ name: "member.md", content: "## Member\ntext\n" }]);
    const before = treeSnapshot(root);

    await expect(runPipelineAsync(cfg(root, out, { localFiles: true })))
      .rejects.toThrow(/DUPLICATE_METADATA_ID: 1 id\(s\) map to more than one path: .*a_b__md: a-b\.md, a_b\.md/);

    expect(treeSnapshot(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, "bundle.l9extracted"))).toBe(false);
    expect(fs.existsSync(path.join(root, "bundle.zip.l9meta.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(out, "coverage-report.json"))).toBe(false);
  }, 20000);

  for (const dryRun of [true, false]) {
    test(`REG-WU-011-RC-020-b: normalizeFilenames never writes a sidecar on a refused run (dryRun=${dryRun})`, async () => {
      const root = tmp("l9-dupord-b-");
      const out = tmp("l9-dupord-b-out-");
      fs.writeFileSync(path.join(root, "A-B.md"), "## A\nbody\n");
      fs.writeFileSync(path.join(root, "a_b.md"), "## B\nbody\n");
      const before = treeSnapshot(root);

      await expect(runPipelineAsync(cfg(root, out, { dryRun, normalizeFilenames: true, glob: "**/*.md" })))
        .rejects.toThrow(/DUPLICATE_METADATA_ID/);

      expect(listRecursive(root).filter((p) => p.endsWith(".normalize.log.yaml"))).toEqual([]);
      expect(treeSnapshot(root)).toEqual(before);
    }, 15000);
  }

  test("REG-WU-011-RC-020-c: the hyphen/underscore refusal keeps its message and writes no coverage report", async () => {
    const root = tmp("l9-dupord-c-");
    const out = tmp("l9-dupord-c-out-");
    fs.writeFileSync(path.join(root, "a-b.md"), "## A\nbody\n");
    fs.writeFileSync(path.join(root, "a_b.md"), "## B\nbody\n");
    await expect(runPipelineAsync(cfg(root, out, { dryRun: true, glob: "**/*.md" })))
      .rejects.toThrow(/^DUPLICATE_METADATA_ID: 1 id\(s\) map to more than one path: l9\.context\.a_b__md: a-b\.md, a_b\.md$/);
    expect(fs.existsSync(path.join(out, "coverage-report.json"))).toBe(false);
  }, 15000);

  test("REG-WU-011-RC-020-d: a non-colliding local-files real run still extracts and injects the archive members", async () => {
    const root = tmp("l9-dupord-d-");
    const out = tmp("l9-dupord-d-out-");
    fs.writeFileSync(path.join(root, "My-Notes.md"), "## Notes\nplain\n");
    writeRawZip(path.join(root, "bundle.zip"), [{ name: "member.md", content: "## Member\ntext\n" }]);

    const result = await runPipelineAsync(cfg(root, out, { localFiles: true, normalizeFilenames: true }));

    expect(result.archives.length).toBe(1);
    expect(result.coverage.archivesExpanded).toBe(1);
    const member = path.join(root, "bundle.l9extracted", "member.md");
    expect(fs.existsSync(member)).toBe(true);
    expect(fs.existsSync(path.join(root, "bundle.zip.l9meta.yaml"))).toBe(true);
    expect(result.metadataSubjects.map((s) => s.path).sort()).toEqual(["My-Notes.md", "bundle.l9extracted/member.md"]);
    const injectedPaths = result.injected.map((r) => path.relative(root, r.sourcePath).split(path.sep).join("/")).sort();
    expect(injectedPaths).toEqual(["My-Notes.md", "bundle.l9extracted/member.md"]);
    expect(fs.readFileSync(member, "utf8")).toMatch(/^---\n[\s\S]*id: "?l9\.context\.bundle_l9extracted_member__md"?\n/);
    // A successful run still writes the normalize sidecar for a renamable name.
    const sidecar = fs.readFileSync(path.join(root, "My-Notes.md.normalize.log.yaml"), "utf8");
    expect(sidecar).toContain("my_notes.md");
    expect(sidecar).toContain("status: sidecar_written");
  }, 20000);

  test("REG-WU-011-RC-020-e: collisions introduced only by extracted members refuse after extraction (documented residual, ADR-073)", async () => {
    const root = tmp("l9-dupord-e-");
    const out = tmp("l9-dupord-e-out-");
    writeRawZip(path.join(root, "a-b.zip"), [{ name: "member.md", content: "## One\ntext\n" }]);
    writeRawZip(path.join(root, "a_b.zip"), [{ name: "member.md", content: "## Two\ntext\n" }]);

    await expect(runPipelineAsync(cfg(root, out, { localFiles: true, normalizeFilenames: true })))
      .rejects.toThrow(/DUPLICATE_METADATA_ID: 1 id\(s\) map to more than one path: .*a_b_l9extracted_member__md: a-b\.l9extracted\/member\.md, a_b\.l9extracted\/member\.md/);

    // Tool-owned extraction artifacts were materialised before the members could be
    // classified; no source byte, normalize sidecar or report was written.
    expect(fs.existsSync(path.join(root, "a-b.l9extracted", "member.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "a_b.l9extracted", "member.md"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "a-b.l9extracted", "member.md"), "utf8")).toBe("## One\ntext\n");
    expect(listRecursive(root).filter((p) => p.endsWith(".normalize.log.yaml"))).toEqual([]);
    expect(fs.existsSync(path.join(out, "coverage-report.json"))).toBe(false);
  }, 20000);
});
