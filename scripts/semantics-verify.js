#!/usr/bin/env node
"use strict";
/**
 * Offline digest verifier for .l9/meta-authority.yaml v2.
 * The operator supplies a Quantum-L9/.github checkout at the bound revision.
 * This script is not part of npm run validate (ADR-048).
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { requireBuilt } = require("./lib/cli-args");

const REPO = path.resolve(__dirname, "..");
const pkg = requireBuilt(path.join(REPO, "dist", "index.js"), "semantics-verify");

function opt(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "";
}

function fail(message) {
  console.error(`semantics-verify: ${message}`);
  process.exit(2);
}

const semanticsRoot = path.resolve(opt("--semantics-root") || "");
if (!opt("--semantics-root")) {
  fail("usage: node scripts/semantics-verify.js --semantics-root <Quantum-L9/.github checkout>");
}
if (!fs.existsSync(semanticsRoot) || !fs.statSync(semanticsRoot).isDirectory()) {
  fail(`not a directory: ${semanticsRoot}`);
}

const loaded = pkg.loadRepositoryAuthority(REPO);
if (loaded.conflicts.length || !loaded.authority) {
  fail(loaded.conflicts.map((c) => `${c.code}: ${c.message}`).join("; ") || "authority missing");
}
if (loaded.authority.schema !== "l9.meta-authority/v2" || !loaded.authority.semantic_foundation) {
  fail("repository authority is not l9.meta-authority/v2");
}

const binding = loaded.authority.semantic_foundation;
const git = spawnSync("git", ["-C", semanticsRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
if (git.status !== 0) {
  fail(`unable to read checkout HEAD: ${git.stderr.trim() || git.stdout.trim()}`);
}
const head = git.stdout.trim();
if (head !== binding.revision) {
  fail(`checkout HEAD ${head} does not match bound revision ${binding.revision}`);
}

const conflicts = pkg.verifySemanticFoundation(binding, semanticsRoot);
if (conflicts.length) {
  for (const item of conflicts) console.error(`semantics-verify: ${item.code}: ${item.message}`);
  process.exit(1);
}
console.log(`semantics-verify: OK — ${Object.keys(binding.ledgers).length} ledgers at ${binding.revision}`);
