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
 *   --out <dir>            manifest/index output dir                 (default: sibling <root>.l9out,
 *                          kept OUTSIDE the scanned root so re-runs never scan/inject their own
 *                          diffs, reports, and indexes)
 *   --index-dir <dir>      index files dir, if different from --out  (default: same as --out)
 *   --namespace <name>     namespace for placement/verify             (default: derived from repo dir name)
 *   --namespace-glob <glob=ns>   per-glob namespace override (repeatable, e.g. "plastos/**=plastos")
 *   --authority <id>       authority id stamped into injected meta    (default: l9.doctrine.platform)
 *   --dry-run              classify + verify only; do NOT write any injected metadata
 *   --fail-on-issues       exit 1 if verification.passed is false     (recommended for CI; default: on)
 *   --no-fail-on-issues    always exit 0 regardless of verification result
 *   --near-dup <0..1>      near-duplicate similarity threshold        (default: 0.9)
 *   --hash-prefix-length <n>  dedup hash-prefix length                (default: 16)
 *   --normalize-filenames  normalize scanned filenames before scanning (default: off)
 *   --write-inject-log     also write a <file>.inject.log next to each mutated file (default: off;
 *                          this CLI keeps scanned trees clean — pass this flag to restore the
 *                          library's per-file change-log default)
 *   --verbose              emit coverage/metrics diagnostics to stderr on every run
 *   --schema <file>        canonical meta-schema YAML (same mechanism as inventory.js --schema):
 *                          MERGE the schema's resolved fields on top of the engine's classified
 *                          identity block before injection — only fields the schema declares are
 *                          added/overridden; canonical taxonomy fields verify/dedup/placement/
 *                          MetaV3 depend on are always preserved. Only takes effect when the
 *                          schema's `target` list includes "file_header".
 *   --llm                              enable LLM-assisted semantic classification/field-assist
 *                                      (src/llm.ts); local no-op adapter is used when this is off.
 *   --llm-base-url <url>               OpenAI-chat-completions-compatible base URL
 *   --llm-api-key <key>                bearer token (prefer LLM_API_KEY env var; see below)
 *   --llm-model <name>                 model name sent in the request body
 *   --llm-allow-insecure               allow sending the bearer token over a non-https base URL
 *                                      (needed for a local endpoint, e.g. Ollama's OpenAI-compat
 *                                      server at http://localhost:11434/v1 — refused by default)
 *
 * The LLM API key may also be supplied via the LLM_API_KEY environment variable instead of
 * --llm-api-key, so it never appears in shell history or process listings.
 */
"use strict";
const path = require("node:path");
const { requireBuilt, parseCli } = require("./lib/cli-args");

const REPO = path.resolve(__dirname, "..");
// runPipelineAsync is the root orchestration entrypoint (docs/public-api-contract.json).
const pkg = requireBuilt(path.join(REPO, "dist", "index.js"), "pipeline-cli");
// loadMetaSchema lives on the "./inventory" subpath, not the root — require the subpath's
// compiled output directly (same approach scripts/inventory.js already uses for it).
const inventoryPkg = requireBuilt(path.join(REPO, "dist", "public", "inventory.js"), "pipeline-cli");

const usage = "usage: node scripts/pipeline-cli.js <root> [--glob PATTERN] [--out DIR] [--index-dir DIR] [--namespace NAME] [--namespace-glob glob=ns] [--authority ID] [--dry-run] [--fail-on-issues|--no-fail-on-issues] [--near-dup 0..1] [--hash-prefix-length N] [--normalize-filenames] [--write-inject-log] [--verbose] [--schema FILE] [--llm] [--llm-base-url URL] [--llm-api-key KEY] [--llm-model NAME] [--llm-allow-insecure]";
const { root, flag, opt, optAll } = parseCli("pipeline-cli", usage);
// Default output dir is a SIBLING of root (<root>.l9out), not nested inside it, so running the
// pipeline never leaves diff/report/index noise in the folder being scanned, and a re-run never
// re-scans or re-injects its own previous output. Pass --out to override.
const outDir = path.resolve(opt("--out", `${root}.l9out`));
const indexDir = path.resolve(opt("--index-dir", outDir));
const failOnIssues = !flag("--no-fail-on-issues");

let metaSchema;
const schemaPath = opt("--schema", null);
if (schemaPath) {
  try {
    metaSchema = inventoryPkg.loadMetaSchema(path.resolve(schemaPath));
    console.error(`pipeline-cli: using meta-schema '${metaSchema.schema_id}' v${metaSchema.version} (${metaSchema.fields.length} fields, target=${metaSchema.target.join(",")})`);
  } catch (e) {
    console.error(`pipeline-cli: bad --schema (${e.message})`);
    process.exit(2);
  }
}

const namespaceGlobs = optAll("--namespace-glob").map((pair, i) => {
  const eq = pair.indexOf("=");
  if (eq < 0) {
    console.error(`pipeline-cli: bad --namespace-glob "${pair}" (expected glob=namespace)`);
    process.exit(2);
  }
  return { glob: pair.slice(0, eq), namespace: pair.slice(eq + 1) };
});

const llmEnabled = flag("--llm");
const config = {
  root,
  glob: opt("--glob", "**/*"),
  dryRun: flag("--dry-run"),
  outDir,
  namespace: opt("--namespace", path.basename(root)),
  namespaceGlobs: namespaceGlobs.length ? namespaceGlobs : undefined,
  authority: opt("--authority", "l9.doctrine.platform"),
  nearDupThreshold: Number(opt("--near-dup", "0.9")),
  hashPrefixLength: Number(opt("--hash-prefix-length", "16")),
  indexDir,
  verbose: flag("--verbose"),
  llmEnabled,
  llmBaseUrl: opt("--llm-base-url", undefined),
  llmApiKey: opt("--llm-api-key", process.env.LLM_API_KEY),
  llmModel: opt("--llm-model", undefined),
  llmAllowInsecure: flag("--llm-allow-insecure"),
  normalizeFilenames: flag("--normalize-filenames"),
  writeInjectLog: flag("--write-inject-log"),
  metaSchema,
};

if (llmEnabled && !(config.llmBaseUrl && config.llmApiKey && config.llmModel)) {
  console.error("pipeline-cli: --llm requires --llm-base-url, --llm-model, and an API key (--llm-api-key or LLM_API_KEY env var); falling back to local (no-op) classification.");
}

console.error(`pipeline-cli: running pipeline over ${root} (namespace=${config.namespace}${config.dryRun ? ", dry-run" : ""}${llmEnabled ? ", llm-assisted" : ""}) …`);

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
