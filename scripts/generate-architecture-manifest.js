#!/usr/bin/env node
"use strict";
// generate-architecture-manifest.js — compute the architecture manifest in memory.
//
// ADR-093 retired the committed `docs/architecture-manifest.json`. It recorded the
// Git blob identity of every authority-critical file, and every one of those files is
// itself committed, so the copy proved only that someone had re-run the generator;
// it moved on almost every pull request and made every open pull request conflict
// with every other. The manifest is now computed from the tree under test and never
// written into the repository.
//
//   --check   compute the manifest (every authority-critical path must exist as a
//             regular file, not a symlink, and appear once) and refuse a revived
//             committed copy.
//   (none)    print the computed manifest to stdout. Nothing is written to disk.
const fs = require("node:fs");
const path = require("node:path");
const { REPO, RETIRED_MANIFEST, buildManifest, stableJson } = require("./lib/architecture-authority");

function fail(message) {
  console.error(`architecture-manifest: FAILED: ${message}`);
  process.exit(1);
}

let manifest;
try {
  manifest = buildManifest(REPO);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (process.argv.includes("--check")) {
  if (fs.existsSync(path.join(REPO, RETIRED_MANIFEST))) {
    fail(`${RETIRED_MANIFEST} is retired (ADR-093); delete it — the manifest is computed, never committed`);
  }
  console.log(`architecture-manifest: OK (${manifest.entries.length} authority-critical files computed from the tree)`);
} else {
  process.stdout.write(stableJson(manifest));
}
