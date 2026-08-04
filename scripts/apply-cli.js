#!/usr/bin/env node
/* carrier-aware governed apply entrypoint */
"use strict";
const path = require("node:path");
const { requireBuilt, parseCli } = require("./lib/cli-args");

const REPO = path.resolve(__dirname, "..");
const pkg = requireBuilt(path.join(REPO, "dist", "index.js"), "apply-cli");
const inventoryPkg = requireBuilt(path.join(REPO, "dist", "public", "inventory.js"), "apply-cli");
const usage = "usage: node scripts/apply-cli.js <root> [--glob PATTERN] [--out DIR] [--namespace NAME] [--namespace-glob glob=ns] --authority ID [--near-dup 0..1] [--hash-prefix-length N] [--verbose] [--schema FILE] [--omit PATTERN] [--omit-file PATH] [--llm] [--llm-base-url URL] [--llm-api-key KEY] [--llm-model NAME] [--llm-allow-insecure]";
const { root, flag, opt, optAll } = parseCli("apply-cli", usage);
const targetRoot = path.resolve(root);
const outDir = path.resolve(opt("--out", `${targetRoot}.l9out`));
const authority = opt("--authority", null);
if (!authority?.trim()) {
  console.error("apply-cli: --authority is required");
  process.exit(2);
}
if ((authority.includes("\u0000") || authority.includes("\r") || authority.includes("\n"))) {
  console.error("apply-cli: --authority contains a forbidden control character");
  process.exit(2);
}
const namespaceGlobs = optAll("--namespace-glob").map((pair) => {
  const eq = pair.indexOf("=");
  if (eq < 1 || eq === pair.length - 1) {
    console.error(`apply-cli: bad --namespace-glob "${pair}" (expected glob=namespace)`);
    process.exit(2);
  }
  return { glob: pair.slice(0, eq), namespace: pair.slice(eq + 1) };
});
let metaSchema;
const schemaPath = opt("--schema", null);
if (schemaPath) {
  try { metaSchema = inventoryPkg.loadMetaSchema(path.resolve(schemaPath)); }
  catch (error) { console.error(`apply-cli: bad --schema (${error.message})`); process.exit(2); }
}
const llmEnabled = flag("--llm");
const config = {
  root: targetRoot,
  glob: opt("--glob", "**/*"),
  outDir,
  namespace: opt("--namespace", path.basename(targetRoot)),
  namespaceGlobs: namespaceGlobs.length ? namespaceGlobs : undefined,
  authority: authority.trim(),
  nearDupThreshold: Number(opt("--near-dup", "0.9")),
  hashPrefixLength: Number(opt("--hash-prefix-length", "16")),
  indexDir: outDir,
  verbose: flag("--verbose"),
  llmEnabled,
  llmBaseUrl: opt("--llm-base-url", undefined),
  llmApiKey: opt("--llm-api-key", process.env.LLM_API_KEY),
  llmModel: opt("--llm-model", undefined),
  llmAllowInsecure: flag("--llm-allow-insecure"),
  normalizeFilenames: false,
  writeInjectLog: false,
  localFiles: false,
  omitPatterns: optAll("--omit"),
  omitFile: opt("--omit-file", undefined),
  metaSchema,
  persistOutputs: false,
};
if (llmEnabled && !(config.llmBaseUrl && config.llmApiKey && config.llmModel)) {
  console.error("apply-cli: --llm requires --llm-base-url, --llm-model, and an API key");
  process.exit(2);
}
console.error(`apply-cli: governed apply over ${targetRoot} ...`);
pkg.runApplyAsync(config).then((operation) => {
  const apply = operation.apply;
  if (!apply) throw new Error("apply operation returned no ApplyResult");
  console.log(`apply-cli: scanned=${apply.scanned} planned=${apply.planned} changed=${apply.changed} inlineChanged=${apply.inlineChanged.length} metadataIndexChanged=${apply.metadataIndexChanged} passed=${apply.passed}`);
  console.log(`apply-cli: transaction=${apply.transaction.transactionId ?? "none"} plannedWrites=${apply.transaction.plannedWrites} committedWrites=${apply.transaction.committedWrites} recovered=${apply.transaction.recoveredTransactions.length} finalized=${apply.transaction.finalizedTransactions.length}`);
  process.exit(apply.passed ? 0 : 1);
}).catch((error) => {
  console.error(`apply-cli: apply threw: ${error?.stack ?? error}`);
  process.exit(2);
});
