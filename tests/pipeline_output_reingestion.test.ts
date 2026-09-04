// pipeline_output_reingestion.test.ts — a run's output is never its next input.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { runPipelineAsync } from "../src/pipeline";
import type { PipelineConfig } from "../src/schema";
import { writeRawZip } from "./helpers/zip_fixtures";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-reingest-"));
}

function cfg(root: string, outDir: string, indexDir = outDir): PipelineConfig {
  return {
    root, glob: "**/*", dryRun: false, outDir, indexDir, namespace: "t", authority: "t",
    nearDupThreshold: 0.9, hashPrefixLength: 16, verbose: false, llmEnabled: false,
    normalizeFilenames: false, writeInjectLog: false, localFiles: false,
  };
}

describe("pipeline — generated output placement", () => {
  test("an output directory inside the root is omitted from the next run", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    const out = path.join(root, "out");
    await runPipelineAsync(cfg(root, out));
    const outputs = fs.readdirSync(out).sort();
    const second = await runPipelineAsync(cfg(root, out));
    expect(second.scanned.map((e) => path.relative(root, e.sourcePath))).toEqual(["a.md"]);
    expect(fs.readdirSync(out).sort()).toEqual(outputs);
    const omitted = second.coverage.discovery.entries.filter((e) => e.path === "out");
    expect(omitted.map((e) => e.disposition)).toEqual(["omitted"]);
  });

  test("a separate index directory inside the root is omitted as well", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    const out = path.join(root, "reports"), index = path.join(root, "index");
    await runPipelineAsync(cfg(root, out, index));
    const second = await runPipelineAsync(cfg(root, out, index));
    expect(second.scanned.map((e) => path.relative(root, e.sourcePath))).toEqual(["a.md"]);
  });

  test("an output directory equal to the root is refused before anything is scanned", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    await expect(runPipelineAsync(cfg(root, root))).rejects.toThrow(/must not equal the root/);
    expect(fs.readFileSync(path.join(root, "a.md"), "utf8")).toBe("# A\n");
  });

  test("a sibling output directory is unaffected", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    const result = await runPipelineAsync(cfg(root, `${root}.out`));
    expect(result.scanned).toHaveLength(1);
  });
});

describe("pipeline — local-files refuses before it materializes", () => {
  test("a tree with a symlink is refused with no extraction directory or sidecar left behind", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    writeRawZip(path.join(root, "Bundle.zip"), [{ name: "docs/x.md", content: "# X\n" }]);
    fs.symlinkSync("a.md", path.join(root, "link.md"));
    const before = fs.readdirSync(root).sort();
    await expect(runPipelineAsync({ ...cfg(root, `${root}.out`), localFiles: true })).rejects.toThrow(/DISCOVERY_INCOMPLETE/);
    expect(fs.readdirSync(root).sort()).toEqual(before);
    expect(fs.existsSync(path.join(root, "Bundle.l9extracted"))).toBe(false);
    expect(fs.existsSync(path.join(root, "Bundle.zip.l9meta.yaml"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "a.md"), "utf8")).toBe("# A\n");
  });

  test("a dry run over the same tree still reports what it would extract", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    writeRawZip(path.join(root, "Bundle.zip"), [{ name: "docs/x.md", content: "# X\n" }]);
    fs.symlinkSync("a.md", path.join(root, "link.md"));
    const result = await runPipelineAsync({ ...cfg(root, `${root}.out`), localFiles: true, dryRun: true });
    expect(result.archives.map((a) => a.heldReason)).toEqual([expect.stringMatching(/^dry-run: 1 member/)]);
    expect(fs.existsSync(path.join(root, "Bundle.l9extracted"))).toBe(false);
  });
});
