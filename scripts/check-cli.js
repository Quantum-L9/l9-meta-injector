#!/usr/bin/env node
/*
 * check-cli.js — deterministic, read-only expected-versus-actual drift gate.
 *
 * The target repository is never used for reports or temporary files. The JSON
 * report must live outside the target root and check exits 1 when drift or an
 * authority conflict is present.
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { requireBuilt, parseCli } = require("./lib/cli-args");

const REPO = path.resolve(__dirname, "..");
const pkg = requireBuilt(path.join(REPO, "dist", "index.js"), "check-cli");
const inventoryPkg = requireBuilt(path.join(REPO, "dist", "public", "inventory.js"), "check-cli");

const usage = "usage: node scripts/check-cli.js <root> [--glob PATTERN] [--report FILE] [--namespace NAME] [--namespace-glob glob=ns] --authority ID [--near-dup 0..1] [--hash-prefix-length N] [--local-files] [--verbose] [--schema FILE] [--omit PATTERN] [--omit-file PATH]";
const { root, flag, opt, optAll } = parseCli("check-cli", usage);
const targetRoot = path.resolve(root);
const reportPath = path.resolve(opt(
  "--report",
  path.join(os.tmpdir(), `l9-meta-injector-check-${process.pid}.json`),
));

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

if (isWithin(targetRoot, reportPath)) {
  console.error(`check-cli: --report must be outside target root (${targetRoot})`);
  process.exit(2);
}

let metaSchema;
const schemaPath = opt("--schema", null);
if (schemaPath) {
  try {
    metaSchema = inventoryPkg.loadMetaSchema(path.resolve(schemaPath));
  } catch (error) {
    console.error(`check-cli: bad --schema (${error.message})`);
    process.exit(2);
  }
}

const authority = opt("--authority", null);
if (!authority?.trim()) {
  console.error("check-cli: --authority is required; no repository-generic authority is assumed");
  process.exit(2);
}
if ((authority.includes("\u0000") || authority.includes("\r") || authority.includes("\n"))) {
  console.error("check-cli: --authority contains a forbidden control character");
  process.exit(2);
}

const namespaceGlobs = optAll("--namespace-glob").map((pair) => {
  const eq = pair.indexOf("=");
  if (eq < 1 || eq === pair.length - 1) {
    console.error(`check-cli: bad --namespace-glob "${pair}" (expected glob=namespace)`);
    process.exit(2);
  }
  return { glob: pair.slice(0, eq), namespace: pair.slice(eq + 1) };
});

const config = {
  root: targetRoot,
  glob: opt("--glob", "**/*"),
  outDir: path.dirname(reportPath),
  namespace: opt("--namespace", path.basename(targetRoot)),
  namespaceGlobs: namespaceGlobs.length ? namespaceGlobs : undefined,
  authority: authority.trim(),
  nearDupThreshold: Number(opt("--near-dup", "0.9")),
  hashPrefixLength: Number(opt("--hash-prefix-length", "16")),
  indexDir: path.dirname(reportPath),
  verbose: flag("--verbose"),
  llmEnabled: false,
  normalizeFilenames: false,
  writeInjectLog: false,
  localFiles: flag("--local-files"),
  omitPatterns: optAll("--omit"),
  omitFile: opt("--omit-file", undefined),
  metaSchema,
  persistOutputs: false,
};

console.error(`check-cli: evaluating ${targetRoot} without mutation ...`);
pkg.runCheckAsync(config).then((operation) => {
  const check = operation.check;
  if (!check) throw new Error("check operation returned no CheckResult");

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(operation, null, 2)}\n`, "utf8");

  console.log(
    `check-cli: scanned=${check.scanned} planned=${check.planned} drift=${check.drift.length} ` +
    `authorityConflicts=${check.authorityConflicts.length} passed=${check.passed}`,
  );
  for (const item of check.drift) {
    console.log(`  - ${item.kind}: ${item.path}: ${item.message}`);
  }
  for (const warning of operation.warnings) console.error(`check-cli: warning: ${warning}`);
  console.log(`check-cli: report=${reportPath}`);
  process.exit(check.passed ? 0 : 1);
}).catch((error) => {
  console.error(`check-cli: check threw: ${error?.stack ?? error}`);
  process.exit(2);
});
