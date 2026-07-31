import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { describe, expect, test } from "vitest";
import { runPipelineAsync } from "../src/pipeline";
import { findFiles } from "../src/retrieval";
import { PipelineConfig } from "../src/schema";
import {
  extractDirFor,
  expandArchivesUnderRoot,
  listZipMembers,
  writeArchiveSidecar,
} from "../src/archives";
import { sidecarPathFor } from "../src/comment";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l9-archives-"));
}

function cfg(root: string, out: string, localFiles = false): PipelineConfig {
  return {
    root, glob: "**/*", dryRun: false, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
    writeInjectLog: false, localFiles,
  };
}

/** Build a zip via system `zip` (same dependency surface as extraction). */
function makeZip(zipPath: string, stagingDir: string, members: Record<string, string>): void {
  fs.mkdirSync(stagingDir, { recursive: true });
  for (const [rel, body] of Object.entries(members)) {
    const abs = path.join(stagingDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
  const names = Object.keys(members);
  execFileSync("zip", ["-q", "-r", zipPath, ...names], { cwd: stagingDir });
}

describe("archives — local-files expansion", () => {
  test("default findFiles excludes .zip (repo mode)", () => {
    const root = tmp();
    const staging = path.join(root, "_stage");
    makeZip(path.join(root, "pack.zip"), staging, { "note.md": "# hello skill capability action\n" });
    fs.writeFileSync(path.join(root, "loose.md"), "# loose skill capability function\n");
    const found = findFiles(root, "**/*");
    expect(found.some((f) => f.endsWith(".zip"))).toBe(false);
    expect(found.some((f) => f.endsWith("loose.md"))).toBe(true);
  });

  test("expandArchivesUnderRoot extracts members and writes sidecar", () => {
    const root = tmp();
    const staging = path.join(root, "_stage");
    const zipPath = path.join(root, "pack.zip");
    makeZip(zipPath, staging, {
      "docs/readme.md": "# Kernel runtime executor sandbox\n\nskill capability action\n",
      "src/util.py": "print('hi')\n",
    });
    const result = expandArchivesUnderRoot(root, { dryRun: false, verbose: false });
    expect(result.archives).toHaveLength(1);
    const extractDir = extractDirFor(zipPath);
    expect(fs.existsSync(path.join(extractDir, "docs", "readme.md"))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, "src", "util.py"))).toBe(true);
    expect(fs.existsSync(sidecarPathFor(zipPath))).toBe(true);
    const sc = fs.readFileSync(sidecarPathFor(zipPath), "utf8");
    expect(sc).toMatch(/artifact_type: archive/);
    expect(sc).toMatch(/member_count: 2/);
  });

  test("dryRun expands but skips archive sidecar", () => {
    const root = tmp();
    const zipPath = path.join(root, "pack.zip");
    makeZip(zipPath, path.join(root, "_stage"), { "a.md": "# doctrine governance policy principle\n" });
    expandArchivesUnderRoot(root, { dryRun: true, verbose: false });
    expect(fs.existsSync(path.join(extractDirFor(zipPath), "a.md"))).toBe(true);
    expect(fs.existsSync(sidecarPathFor(zipPath))).toBe(false);
  });

  test("listZipMembers rejects Zip-Slip paths", () => {
    const root = tmp();
    const evil = path.join(root, "evil.zip");
    execFileSync("python3", ["-c", `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1], 'w')
z.writestr('../escape.txt', 'nope')
z.close()
`, evil]);
    expect(() => listZipMembers(evil)).toThrow(/unsafe zip member/);
  });

  test("pipeline localFiles injects extracted members and sidecars the zip", async () => {
    const root = tmp();
    const out = tmp();
    const zipPath = path.join(root, "bundle.zip");
    // Use path/keyword signals that classify as injectable (skill / source)
    makeZip(zipPath, path.join(root, "_stage"), {
      "skills/do-thing.md": [
        "# Do Thing",
        "",
        "This skill capability function action operation handles routing.",
        "",
      ].join("\n"),
      "code/helper.py": "def run():\n    return 1\n",
    });
    fs.writeFileSync(
      path.join(root, "top.md"),
      "# Top doctrine governance policy principle standard\n\nOutside the zip.\n",
    );

    const without = await runPipelineAsync(cfg(root, out, false));
    expect(without.coverage.archivesExpanded).toBe(0);
    expect(without.archives).toHaveLength(0);
    // Without localFiles, zip members are invisible
    expect(without.injected.every((r) => !r.sourcePath.includes(".l9extracted"))).toBe(true);

    const out2 = tmp();
    const withLocal = await runPipelineAsync(cfg(root, out2, true));
    expect(withLocal.coverage.archivesExpanded).toBe(1);
    expect(withLocal.archives).toHaveLength(1);
    expect(fs.existsSync(sidecarPathFor(zipPath))).toBe(true);
    expect(fs.existsSync(path.join(out2, "archives-expanded.json"))).toBe(true);

    const extractedMd = path.join(extractDirFor(zipPath), "skills", "do-thing.md");
    const extractedPy = path.join(extractDirFor(zipPath), "code", "helper.py");
    expect(fs.existsSync(extractedMd)).toBe(true);
    expect(fs.readFileSync(extractedMd, "utf8")).toMatch(/^---/);
    expect(fs.readFileSync(extractedPy, "utf8")).toMatch(/l9:meta/);
    expect(withLocal.injected.some((r) => r.sourcePath === extractedMd)).toBe(true);
    expect(withLocal.injected.some((r) => r.sourcePath === extractedPy)).toBe(true);
  });

  test("nested zip is expanded within maxDepth", () => {
    const root = tmp();
    const innerStage = path.join(root, "_inner");
    const outerStage = path.join(root, "_outer");
    fs.mkdirSync(outerStage, { recursive: true });
    const innerZip = path.join(outerStage, "inner.zip");
    makeZip(innerZip, innerStage, {
      "nested.md": "# Nested skill capability function action\n",
    });
    fs.writeFileSync(path.join(outerStage, "outer.md"), "# Outer skill capability function action\n");
    const outerZip = path.join(root, "outer.zip");
    execFileSync("zip", ["-q", "-r", outerZip, "inner.zip", "outer.md"], { cwd: outerStage });

    const result = expandArchivesUnderRoot(root, { dryRun: false, verbose: false, maxDepth: 3 });
    expect(result.archives.length).toBeGreaterThanOrEqual(2);
    const outerExtract = extractDirFor(outerZip);
    const nestedMd = path.join(outerExtract, "inner.l9extracted", "nested.md");
    expect(fs.existsSync(path.join(outerExtract, "outer.md"))).toBe(true);
    expect(fs.existsSync(nestedMd)).toBe(true);
  });
});

describe("writeArchiveSidecar", () => {
  test("writes fenced yaml next to the zip", () => {
    const root = tmp();
    const zipPath = path.join(root, "x.zip");
    makeZip(zipPath, path.join(root, "_s"), { "a.txt": "hi\n" });
    const extractDir = extractDirFor(zipPath);
    fs.mkdirSync(extractDir, { recursive: true });
    const sc = writeArchiveSidecar(zipPath, extractDir, 1);
    expect(sc).toBe(sidecarPathFor(zipPath));
    expect(fs.readFileSync(sc, "utf8")).toMatch(/^---\n/);
  });
});
