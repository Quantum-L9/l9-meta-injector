/**
 * WU-009 — pipeline verification is truthful in dry-run (RC-015 / F-029) and every
 * eligible file is accounted for in coverage (RC-021 / F-035).
 *
 * Dry-run used to verify every planned record against the bytes it had deliberately
 * not written, so a correct plan reported `verification.passed=false` and pipeline-cli
 * `--dry-run` exited 1. Inline-carrier-blocked files were skipped by the injection loop
 * and appeared in no coverage bucket at all.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runPipelineAsync } from "../src/pipeline";
import type { PipelineConfig } from "../src/schema";

const dirs: string[] = [];

function tmpDir(prefix = "l9-wu009-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function cfg(root: string, out: string, dryRun: boolean, glob = "**/*"): PipelineConfig {
  return {
    root, glob, dryRun, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
  };
}

function treeHash(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = path.join(dir, entry.name);
      hash.update(`${entry.isDirectory() ? "d" : "f"}:${path.relative(root, full)}\0`);
      if (entry.isDirectory()) walk(full);
      else hash.update(fs.readFileSync(full));
    }
  };
  walk(root);
  return hash.digest("hex");
}

function persistedCoverage(out: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(out, "coverage-report.json"), "utf8")) as Record<string, unknown>;
}

const HEADER_ISSUES = /No full-YAML front matter detected|No l9:meta comment block detected|No l9meta sidecar file detected|Body content changed/;

describe("WU-009 RC-015 dry-run verification", () => {
  test("REG-WU-009-RC-015-a: dry-run over an unannotated tree passes and persists verifyFailed=0, tree unchanged", async () => {
    const root = tmpDir(); const out = tmpDir();
    fs.writeFileSync(path.join(root, "notes.md"), "# Notes\n\nSome notes.\n");
    fs.writeFileSync(path.join(root, "app.ts"), "export const answer = 42;\n");
    const before = treeHash(root);

    const result = await runPipelineAsync(cfg(root, out, true));

    expect(result.injected.length).toBe(2);
    expect(result.injected.every((r) => r.wouldChange === true)).toBe(true);
    expect(result.verification.withIssues).toBe(0);
    expect(result.verification.passed).toBe(true);
    expect(result.coverage.verifyFailed).toBe(0);
    expect(persistedCoverage(out).verifyFailed).toBe(0);
    expect(treeHash(root)).toBe(before);
  }, 20000);

  test("REG-WU-009-RC-015-b: meta-derived issues are still reported in dry-run, header issues are not", async () => {
    const root = tmpDir(); const out = tmpDir();
    fs.mkdirSync(path.join(root, "common"));
    const fp = path.join(root, "common", "guide.md");
    fs.writeFileSync(fp, "# Guide\n\nShared guidance.\n");

    const result = await runPipelineAsync(cfg(root, out, true));

    const record = result.injected.find((r) => r.sourcePath === fp);
    expect(record?.meta.sharing_scope).toBe("shared");
    expect(record?.meta.namespace).not.toBe("shared");
    expect(record?.meta.namespace).not.toBe("core");
    expect(result.verification.passed).toBe(false);
    const failure = result.verification.failures.find((f) => f.sourcePath === fp);
    expect(failure?.issues.some((i) => i.startsWith("sharing_scope=shared"))).toBe(true);
    expect(failure?.issues.some((i) => HEADER_ISSUES.test(i))).toBe(false);
    expect(result.coverage.verifyFailed).toBe(result.verification.withIssues);
  }, 20000);

  test("REG-WU-009-RC-015-c: a real run still fails verification for the incomplete-prompt fixture", async () => {
    const root = tmpDir(); const out = tmpDir();
    fs.mkdirSync(path.join(root, "prompts"));
    const fp = path.join(root, "prompts", "Prompt-Incomplete.md");
    fs.writeFileSync(fp, "Some freeform prose with no role, objective, inputs, output format, or model target.\n");

    const result = await runPipelineAsync(cfg(root, out, false, "**/*.md"));

    expect(result.verification.passed).toBe(false);
    const failure = result.verification.failures.find((f) => f.sourcePath === fp);
    expect(failure).toBeDefined();
    expect(failure!.issues.length).toBeGreaterThan(0);
  }, 20000);

  test("REG-WU-009-RC-015-d: dry-run over an already annotated tree verifies every record in full from disk", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "notes.md"), "# Notes\n\nSome notes.\n");
    fs.writeFileSync(path.join(root, "app.ts"), "export const answer = 42;\n");
    const real = await runPipelineAsync(cfg(root, tmpDir(), false));
    expect(real.verification.passed).toBe(true);

    const annotated = await runPipelineAsync(cfg(root, tmpDir(), true));
    expect(annotated.injected.length).toBe(2);
    expect(annotated.injected.every((r) => r.wouldChange === false)).toBe(true);
    expect(annotated.verification.passed).toBe(true);
    expect(annotated.verification.total).toBe(2);

    // A corrupted header is a planned repair, not a written failure: its record is
    // wouldChange=true, so dry-run does not report the pre-repair bytes as broken, and
    // the real run that writes the repair verifies clean from disk.
    const notes = path.join(root, "notes.md");
    fs.writeFileSync(notes, fs.readFileSync(notes, "utf8").replace(/^---\n[\s\S]*?\n---\n/, ""));
    const corrupted = await runPipelineAsync(cfg(root, tmpDir(), true));
    expect(corrupted.injected.find((r) => r.sourcePath === notes)?.wouldChange).toBe(true);
    expect(corrupted.verification.passed).toBe(true);
    const repaired = await runPipelineAsync(cfg(root, tmpDir(), false));
    expect(repaired.verification.passed).toBe(true);
  }, 30000);

  test("REG-WU-009-RC-015-e: pipeline-cli --dry-run exits 0 on a correct plan", () => {
    const root = tmpDir(); const out = tmpDir();
    fs.writeFileSync(path.join(root, "notes.md"), "# Notes\n\nSome notes.\n");
    fs.writeFileSync(path.join(root, "app.ts"), "export const answer = 42;\n");
    const before = treeHash(root);
    const script = path.join(__dirname, "..", "scripts", "pipeline-cli.js");
    const run = spawnSync(process.execPath, [script, root, "--dry-run", "--authority", "x", "--out", out, "--index-dir", out], { encoding: "utf8" });
    expect(run.stderr).not.toMatch(/verification FAILED/);
    expect(run.status).toBe(0);
    expect(treeHash(root)).toBe(before);
  }, 30000);
});

const NESTED_DOC = "---\ntitle: x\nauthor:\n  name: A\n---\n# Nested\n\nBody.\n";
const MALFORMED_DOC = "---\ntitle: x\n# Never closed\n\nBody.\n";

describe("WU-009 RC-021 inline-carrier-blocked files are accounted", () => {
  test("REG-WU-009-RC-021-a: a blocked file is listed with its reason and issue code", async () => {
    const root = tmpDir(); const out = tmpDir();
    fs.writeFileSync(path.join(root, "ok.md"), "# Ok\n\nFine.\n");
    const nested = path.join(root, "nested.md");
    fs.writeFileSync(nested, NESTED_DOC);

    const result = await runPipelineAsync(cfg(root, out, false, "**/*.md"));

    expect(result.coverage.scanned).toBe(2);
    expect(result.coverage.injected).toBe(1);
    expect(result.coverage.skippedNonInjectable).toBe(1);
    expect(result.coverage.skipped.nonInjectable).toEqual([nested]);
    const detail = result.coverage.skipped.nonInjectableDetails[0];
    expect(detail?.path).toBe(nested);
    expect(detail?.reason).toBe("carrier_inline_blocked");
    expect(detail?.inlineCarrierBlock?.code).toBe("FRONTMATTER_COMPLEX_YAML");
    expect(detail?.inlineCarrierBlock?.malformed).toBe(false);
    expect(result.coverage.injected + result.coverage.skippedBinary + result.coverage.skippedNonInjectable).toBe(result.coverage.scanned);
    expect(fs.readFileSync(nested, "utf8")).toBe(NESTED_DOC);
  }, 20000);

  test("REG-WU-009-RC-021-b: the persisted coverage report names the blocked file and its issue code", async () => {
    const root = tmpDir(); const out = tmpDir();
    fs.writeFileSync(path.join(root, "ok.md"), "# Ok\n\nFine.\n");
    const nested = path.join(root, "nested.md");
    fs.writeFileSync(nested, NESTED_DOC);

    await runPipelineAsync(cfg(root, out, false, "**/*.md"));

    const persisted = persistedCoverage(out) as { skipped: { nonInjectable: string[]; nonInjectableDetails: Array<Record<string, unknown>> } };
    expect(persisted.skipped.nonInjectable).toContain(nested);
    const detail = persisted.skipped.nonInjectableDetails.find((d) => d.path === nested);
    expect(detail?.reason).toBe("carrier_inline_blocked");
    expect((detail?.inlineCarrierBlock as { code?: string } | undefined)?.code).toBe("FRONTMATTER_COMPLEX_YAML");
  }, 20000);

  test("REG-WU-009-RC-021-c: a malformed header is listed with malformed:true in dry-run, bytes unchanged", async () => {
    const root = tmpDir(); const out = tmpDir();
    const broken = path.join(root, "broken.md");
    fs.writeFileSync(broken, MALFORMED_DOC);

    const result = await runPipelineAsync(cfg(root, out, true, "**/*.md"));

    const detail = result.coverage.skipped.nonInjectableDetails.find((d) => d.path === broken);
    expect(detail?.reason).toBe("carrier_inline_blocked");
    expect(detail?.inlineCarrierBlock?.malformed).toBe(true);
    expect(result.coverage.injected + result.coverage.skippedBinary + result.coverage.skippedNonInjectable).toBe(result.coverage.scanned);
    expect(fs.readFileSync(broken, "utf8")).toBe(MALFORMED_DOC);
  }, 20000);
});
