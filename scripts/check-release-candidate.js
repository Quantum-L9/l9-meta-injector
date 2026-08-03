#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const REPO = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(REPO, "package-lock.json"), "utf8"));
const publication = JSON.parse(fs.readFileSync(path.join(REPO, "docs/package-publication-decision.json"), "utf8"));
const plan = JSON.parse(fs.readFileSync(path.join(REPO, "docs/release/v4.0.0-release-plan.json"), "utf8"));
const dispatch = fs.readFileSync(path.join(REPO, "scripts/lib/operation-dispatch.js"), "utf8");
const errors = [];
if (pkg.version !== "4.0.0") errors.push("package version is not 4.0.0");
if (lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) errors.push("package-lock version mismatch");
if (lock.packages?.[""]?.license !== pkg.license) errors.push("package-lock license mismatch");
if (pkg.bin?.["l9-meta-injector"] !== "scripts/operation-cli.js") errors.push("package executable is missing");
if (!Array.isArray(pkg.files) || !pkg.files.includes("scripts")) errors.push("runtime scripts are not packed");
if (publication.package_version !== pkg.version) errors.push("publication decision version mismatch");
if (plan.release_version !== pkg.version || plan.tag !== `v${pkg.version}`) errors.push("release plan identity mismatch");
if (!dispatch.includes('actionPath: path.resolve(__dirname, "..", ".."),')) errors.push("packed CLI action root is incorrect");
if (!dispatch.includes("uploadArtifact: false,")) errors.push("CLI upload-artifact default is not contained");
if (errors.length) {
  console.error("release-candidate: BLOCKED");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log("release-candidate: PASS");
