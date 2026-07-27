#!/usr/bin/env node
/*
 * pipeline-cli.js — run the full l9-meta-injector orchestration pipeline
 * (scan → extract → assist → inject → verify → index) against ANY folder,
 * and exit non-zero on verification failure so it can gate CI.
 *
 *   node scripts/pipeline-cli.js <root> [options]
 *   npm run pipeline -- <root> [options]
 *
 * Options:
 *   --glob <pattern>       file glob to scan                         (default: **\/*)
 *   --out <dir>            manifest/index output dir                 (default: <root>/.l9out)
 *   --namespace <name>     namespace for placement/verify             (default: derived from repo dir name)
 *   --authority <id>       authority id stamped into injected meta    (default: l9.doctrine.platform)
 *   --dry-run              classify + verify only; do NOT write any injected metadata
 *   --fail-on-issues       exit 1 if verification.passed is false     (recommended for CI; default: on)
 *   --no-fail-on-issues    always exit 0 regardless of verification result
 *   --near-dup <0..1>      near-duplicate similarity threshold        (default: 0.9)
 */
"use strict";
const path = require("node:path");
const { requireBuilt, parseCli } = require("./lib/cli-args");

const REPO = path.resolve(__dirname, "..");
// runPipelineAsync is the root orchestration entrypoint (docs/public-api-contract.json).
const pkg = requireBuilt(path.join(REPO, "dist", "index.js"), "pipeline-cli");

const usage = "usage: node scripts/pipeline-cli.js <root> [--glob PATTERN] [--out DIR] [--namespace NAME] [--authority ID] [--dry-run] [--fail-on-issues|--no-fail-on-issues] [--near-dup 0..1]";
const { root, flag, opt } = parseCli("pipeline-cli", usage);
const outDir = path.resolve(opt("--out", path.join(root, ".l9out")));
const failOnIssues = !flag("--no-fail-on-issues");

const config = {
  root,
  glob: opt("--glob", "**/*"),
  dryRun: flag("--dry-run"),
  outDir,
  namespace: opt("--namespace", path.basename(root)),
  authority: opt("--authority", "l9.doctrine.platform"),
  nearDupThreshold: Number(opt("--near-dup", "0.9")),
  hashPrefixLength: 16,
  indexDir: outDir,
  verbose: false,
  llmEnabled: false,
  normalizeFilenames: false,
};

console.error(`pipeline-cli: running pipeline over ${root} (namespace=${config.namespace}${config.dryRun ? ", dry-run" : ""}) …`);

pkg.runPipelineAsync(config).then((result) => {
  const { coverage, verification } = result;
  console.log(`pipeline-cli: scanned=${coverage.scanned} injected=${coverage.injected} skippedBinary=${coverage.skippedBinary} skippedNonInjectable=${coverage.skippedNonInjectable} verifyFailed=${coverage.verifyFailed}`);
  console.log(`pipeline-cli: verification total=${verification.total} clean=${verification.clean} withIssues=${verification.withIssues} passed=${verification.passed}`);
  if (!verification.passed) {
    console.log("pipeline-cli: verification failures:");
    for (const f of verification.failures) console.log(`  - ${f.sourcePath}: ${f.issues.join("; ")}`);
  }
  console.log(`pipeline-cli: output written to ${path.relative(process.cwd(), outDir)}`);
  if (config.dryRun) console.log("pipeline-cli: (dry-run: no files were modified; manifest/index only)");

  if (failOnIssues && !verification.passed) {
    console.error("pipeline-cli: FAILED — verification issues found (see above). Pass --no-fail-on-issues to make this advisory only.");
    process.exit(1);
  }
}).catch((e) => {
  console.error(`pipeline-cli: pipeline threw: ${e?.stack ?? e}`);
  process.exit(2);
});
