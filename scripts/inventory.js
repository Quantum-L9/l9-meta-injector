#!/usr/bin/env node
/*
 * inventory.js — point the l9-meta-injector at ANY folder (hard drive, Dropbox, …)
 * and produce a non-destructive inventory: classify every file AND folder, append
 * metadata headers to text files, write metadata sidecars for binaries and folders,
 * and emit an inventory manifest (JSON + CSV + MD). Never moves, renames, or deletes.
 *
 *   node scripts/inventory.js <root> [options]
 *   npm run inventory -- <root> [options]
 *
 * Options:
 *   --out <dir>        where to write inventory.{json,csv,md}   (default: sibling <root>.l9inventory,
 *                      kept OUTSIDE the scanned root so re-runs never inventory/mutate their own
 *                      previously generated manifests)
 *   --source <name>    source_system: dropbox|github|local|upload|unknown  (default: local)
 *   --dry-run          classify + manifest only; do NOT touch any file/folder
 *   --no-inject        do not append headers to text files (sidecars/manifest only)
 *   --no-folder-sidecars   do not write <folder>/.l9meta.yaml
 *   --ignore a,b,c     comma-list of directory names to skip (default: node_modules,.git)
 *   --hash-max-bytes <n>   skip content_hash for files larger than n bytes (default: 50 MiB);
 *                      large files are still inventoried, just without a content hash
 *   --schema <file>    canonical meta-schema YAML: customize which meta fields are
 *                      emitted, required, defaulted, and where each value comes from
 */
"use strict";
const path = require("node:path");
const { requireBuilt, parseCli } = require("./lib/cli-args");

const REPO = path.resolve(__dirname, "..");
// inventoryTree/loadMetaSchema live on the "./inventory" subpath (docs/public-api-contract.json),
// not the root orchestration entrypoint — require the subpath's compiled output directly so this
// CLI stays correct if the root's re-exports ever change.
const pkg = requireBuilt(path.join(REPO, "dist", "public", "inventory.js"), "inventory");

const usage = "usage: node scripts/inventory.js <root> [--out DIR] [--source NAME] [--dry-run] [--no-inject] [--no-folder-sidecars] [--ignore a,b] [--hash-max-bytes N] [--schema FILE] [-h|--help]";
const KNOWN = {
  flags: ["--dry-run", "--no-inject", "--no-folder-sidecars"],
  opts: ["--out", "--source", "--ignore", "--hash-max-bytes", "--schema"],
};
const { root, flag, opt } = parseCli("inventory", usage, KNOWN);
// Default output dir is a SIBLING of root (<root>.l9inventory), not nested inside it, so scanning
// never leaves manifest noise in the folder being inventoried. Pass --out to override.
const outDir = path.resolve(opt("--out", `${root}.l9inventory`));
const now = new Date().toISOString();

let schema;
const schemaPath = opt("--schema", null);
if (schemaPath) {
  try { schema = pkg.loadMetaSchema(path.resolve(schemaPath)); console.error(`inventory: using meta-schema '${schema.schema_id}' v${schema.version} (${schema.fields.length} fields)`); }
  catch (e) { console.error(`inventory: bad --schema (${e.message})`); process.exit(2); }
}

// --hash-max-bytes: cap the file size above which content_hash is skipped (engine
// default 50 MiB). Only pass it through when supplied and valid; a bad value fails
// loudly rather than silently degrading to the default.
let hashMaxBytes;
const hashMaxBytesRaw = opt("--hash-max-bytes", null);
if (hashMaxBytesRaw !== null) {
  hashMaxBytes = Number(hashMaxBytesRaw);
  if (!Number.isInteger(hashMaxBytes) || hashMaxBytes < 0) {
    console.error(`inventory: bad --hash-max-bytes "${hashMaxBytesRaw}" (expected a non-negative integer number of bytes)`);
    process.exit(2);
  }
}

const config = {
  root,
  outDir,
  sourceSystem: opt("--source", "local"),
  dryRun: flag("--dry-run"),
  injectHeaders: !flag("--no-inject"),
  folderSidecars: !flag("--no-folder-sidecars"),
  ignore: (opt("--ignore", "node_modules,.git")).split(",").map((s) => s.trim()).filter(Boolean).concat([".l9inventory"]),
  hashMaxBytes,
  now,
  schema,
};

console.error(`inventory: scanning ${root}${config.dryRun ? " (dry-run)" : ""} …`);
const r = pkg.inventoryTree(config);
console.log(`inventory: ${r.total} entries (${r.files} files, ${r.folders} folders)`);
console.log(`  types: ${JSON.stringify(r.typeDistribution)}`);
console.log(`  duplicate clusters: ${r.duplicates.length}`);
console.log(`  manifest: ${path.relative(process.cwd(), r.manifestPaths.json)}`);
console.log(`           ${path.relative(process.cwd(), r.manifestPaths.csv)}`);
console.log(`           ${path.relative(process.cwd(), r.manifestPaths.md)}`);
console.log(`           ${path.relative(process.cwd(), r.manifestPaths.duplicates)}`);
if (config.dryRun) console.log("  (dry-run: no files/folders were modified; manifest only)");
