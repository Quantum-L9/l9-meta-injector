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
 *   --out <dir>        where to write inventory.{json,csv,md}   (default: <root>/.l9inventory)
 *   --source <name>    source_system: dropbox|github|local|upload|unknown  (default: local)
 *   --dry-run          classify + manifest only; do NOT touch any file/folder
 *   --no-inject        do not append headers to text files (sidecars/manifest only)
 *   --no-folder-sidecars   do not write <folder>/.l9meta.yaml
 *   --ignore a,b,c     comma-list of directory names to skip (default: node_modules,.git)
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pkg;
try { pkg = require(path.join(REPO, "dist", "index.js")); }
catch (e) { console.error(`inventory: run "npm run build" first (${e.message})`); process.exit(2); }

const argv = process.argv.slice(2);
if (!argv.length || argv[0].startsWith("-")) {
  console.error("usage: node scripts/inventory.js <root> [--out DIR] [--source NAME] [--dry-run] [--no-inject] [--no-folder-sidecars] [--ignore a,b]");
  process.exit(2);
}
function flag(name) { return argv.includes(name); }
function opt(name, def) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; }

const root = path.resolve(argv[0]);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) { console.error(`inventory: not a directory: ${root}`); process.exit(2); }
const outDir = path.resolve(opt("--out", path.join(root, ".l9inventory")));
const now = new Date().toISOString();

const config = {
  root,
  outDir,
  sourceSystem: opt("--source", "local"),
  dryRun: flag("--dry-run"),
  injectHeaders: !flag("--no-inject"),
  folderSidecars: !flag("--no-folder-sidecars"),
  ignore: (opt("--ignore", "node_modules,.git")).split(",").map((s) => s.trim()).filter(Boolean).concat([".l9inventory"]),
  now,
};

console.error(`inventory: scanning ${root}${config.dryRun ? " (dry-run)" : ""} …`);
const r = pkg.inventoryTree(config);
console.log(`inventory: ${r.total} entries (${r.files} files, ${r.folders} folders)`);
console.log(`  types: ${JSON.stringify(r.typeDistribution)}`);
console.log(`  manifest: ${path.relative(process.cwd(), r.manifestPaths.json)}`);
console.log(`           ${path.relative(process.cwd(), r.manifestPaths.csv)}`);
console.log(`           ${path.relative(process.cwd(), r.manifestPaths.md)}`);
if (config.dryRun) console.log("  (dry-run: no files/folders were modified; manifest only)");
