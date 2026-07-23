#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { REPO, buildManifest, stableJson } = require("./lib/architecture-authority");
const target = path.join(REPO, "docs", "architecture-manifest.json");
const rendered = stableJson(buildManifest(REPO));
if (process.argv.includes("--check")) {
  if (!fs.existsSync(target)) { console.error("architecture manifest missing"); process.exit(1); }
  const current = fs.readFileSync(target, "utf8");
  if (current !== rendered) { console.error("architecture manifest is stale; run npm run manifest:update"); process.exit(1); }
  console.log("architecture-manifest: OK");
} else {
  fs.writeFileSync(target, rendered, "utf8");
  console.log("architecture-manifest: updated");
}
