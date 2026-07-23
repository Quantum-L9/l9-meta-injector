"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const pkg = require("l9-meta-injector");

(async () => {
  assert.strictEqual(typeof pkg.runPipelineAsync, "function", "runPipelineAsync is not a runtime export");
  const resolved = require.resolve("l9-meta-injector");
  assert(resolved.includes(path.join("node_modules", "l9-meta-injector", "dist", "index.js")), `unexpected runtime resolution: ${resolved}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "l9-consumer-runtime-"));
  try {
    const input = path.join(work, "input");
    const out = path.join(work, "out");
    const index = path.join(work, "index");
    fs.mkdirSync(input, { recursive: true });
    const file = path.join(input, "artifact.md");
    const original = "# Consumer artifact\n\nA deterministic packed-consumer smoke fixture.\n";
    fs.writeFileSync(file, original, "utf8");
    const result = await pkg.runPipelineAsync({
      root: input,
      glob: "**/*.md",
      dryRun: true,
      outDir: out,
      namespace: "consumer",
      authority: "consumer.smoke",
      nearDupThreshold: 0.9,
      hashPrefixLength: 16,
      indexDir: index,
      verbose: false,
      llmEnabled: false,
      normalizeFilenames: false,
    });
    assert.strictEqual(fs.readFileSync(file, "utf8"), original, "dry-run mutated the source file");
    assert(result && Array.isArray(result.scanned), "pipeline result has no scanned array");
    assert(result.coverage && typeof result.coverage.scanned === "number", "pipeline result has no coverage summary");
    assert(result.verification && typeof result.verification.passed === "boolean", "pipeline result has no verification summary");
    process.stdout.write(JSON.stringify({ resolved, scanned: result.coverage.scanned, injected: result.coverage.injected, sourcePreserved: true }) + "\n");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error && error.stack ? error.stack : error); process.exit(1); });
