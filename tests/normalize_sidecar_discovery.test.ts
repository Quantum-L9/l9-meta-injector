/**
 * WU-013 — normalize-filenames sidecars are generated artifacts, never inputs
 * (RC-016 / F-030).
 *
 * `normalizeFilenames` writes `<file>.normalize.log.yaml` into the scanned tree. Discovery
 * did not recognise that suffix, so every run rediscovered its own sidecars, normalized
 * them (spawning a nested sidecar per sidecar) and, in a real run, injected metadata
 * into them. The tree never converged.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { discoverFiles } from "../src/retrieval";
import { runPipelineAsync } from "../src/pipeline";
import type { PipelineConfig } from "../src/schema";

const dirs: string[] = [];

function tmpDir(prefix = "l9-wu013-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function cfg(root: string, dryRun: boolean): PipelineConfig {
  const out = tmpDir("l9-wu013-out-");
  return {
    root, glob: "**/*", dryRun, outDir: out, indexDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    verbose: false, llmEnabled: false, normalizeFilenames: true,
  };
}

function sidecars(root: string): string[] {
  return fs.readdirSync(root).filter((name) => name.endsWith(".normalize.log.yaml")).sort();
}

function disposition(root: string, relative: string): string | undefined {
  return discoverFiles(root, "**/*").summary.entries.find((entry) => entry.path === relative)?.disposition;
}

describe("WU-013 normalize sidecars are excluded from discovery", () => {
  test("REG-WU-013-RC-016-a: two dry-runs leave exactly one sidecar and the second run does not scan it", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "My Notes.md"), "# My notes\n\nBody.\n");

    await runPipelineAsync(cfg(root, true));
    expect(sidecars(root)).toEqual(["My Notes.md.normalize.log.yaml"]);

    const second = await runPipelineAsync(cfg(root, true));
    expect(sidecars(root)).toEqual(["My Notes.md.normalize.log.yaml"]);
    expect(second.scanned.map((e) => path.basename(e.sourcePath))).toEqual(["My Notes.md"]);
  }, 20000);

  test("REG-WU-013-RC-016-b: a sidecar is a generated artifact in the discovery ledger", () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "x.md"), "# X\n");
    fs.writeFileSync(path.join(root, "x.md.normalize.log.yaml"), "original: x.md\n");

    const result = discoverFiles(root, "**/*");
    expect(result.files.map((f) => path.basename(f))).toEqual(["x.md"]);
    expect(disposition(root, "x.md.normalize.log.yaml")).toBe("generated_artifact");
  });

  test("REG-WU-013-RC-016-c: a real run never injects into a prior sidecar or nests a new one", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "My Notes.md"), "# My notes\n\nBody.\n");
    await runPipelineAsync(cfg(root, true));
    const sidecar = path.join(root, "My Notes.md.normalize.log.yaml");
    const before = fs.readFileSync(sidecar, "utf8");

    const real = await runPipelineAsync(cfg(root, false));

    expect(real.injected.map((r) => path.basename(r.sourcePath))).toEqual(["My Notes.md"]);
    const after = fs.readFileSync(sidecar, "utf8");
    expect(after).not.toContain("l9:meta");
    expect(sidecars(root)).toEqual(["My Notes.md.normalize.log.yaml"]);
    // The real run rewrites the sidecar's own log record; it never gains a header.
    expect(after.split("\n")[0]).toBe(before.split("\n")[0]);
  }, 20000);

  test("REG-WU-013-RC-016-d: existing generated suffixes stay generated and plain YAML stays eligible", () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "a.md.inject.log"), "log\n");
    fs.writeFileSync(path.join(root, "b.md.l9meta.yaml"), "id: b\n");
    fs.writeFileSync(path.join(root, "notes.yaml"), "key: value\n");

    expect(disposition(root, "a.md.inject.log")).toBe("generated_artifact");
    expect(disposition(root, "b.md.l9meta.yaml")).toBe("generated_artifact");
    expect(disposition(root, "notes.yaml")).toBe("eligible");
  });
});
