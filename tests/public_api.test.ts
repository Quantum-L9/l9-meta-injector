import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as assist from "../src/assist";
import { runPipelineAsync } from "../src/pipeline";
import { PipelineConfig } from "../src/schema";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "l9-api-")); }

// DWL-008 coverage (root vs. ./advanced export boundaries) now lives in
// tests/public_api_runtime.test.ts, which asserts these primitives are public
// via the ./advanced subpath and intentionally excluded from the root entrypoint.

describe("DWL-004 — dead isMateriallyBetter and orphaned materialityCheck are gone", () => {
  test("isMateriallyBetter is no longer exported", () => {
    expect((assist as Record<string, unknown>).isMateriallyBetter).toBeUndefined();
  });
  test("DEFAULT_ASSIST_CONFIG no longer carries materialityCheck", () => {
    expect("materialityCheck" in assist.DEFAULT_ASSIST_CONFIG).toBe(false);
  });
});

describe("DWL-005 — namespaceGlobs on PipelineConfig reaches injected metadata", () => {
  test("a per-glob override changes the injected namespace", async () => {
    const root = tmp(); const out = tmp();
    const skills = path.join(root, "skills"); fs.mkdirSync(skills);
    fs.writeFileSync(path.join(skills, "lint_file.md"), "## Role\nAuditor\n\n## Validation Gates\n- x\n");

    const cfg: PipelineConfig = {
      root, glob: "**/*.md", dryRun: false, outDir: out, namespace: "l9",
      authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
      indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
      namespaceGlobs: [{ glob: "**", namespace: "custom_ns" }],
    };
    const result = await runPipelineAsync(cfg);
    expect(result.injected.length).toBeGreaterThan(0);
    expect(result.injected.every((r) => r.meta.namespace === "custom_ns")).toBe(true);

    // And it is actually written into the file header, not just the in-memory record.
    const content = fs.readFileSync(path.join(skills, "lint_file.md"), "utf8");
    expect(content).toContain("namespace: custom_ns");
  }, 15000);
});
